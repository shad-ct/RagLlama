const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse-debugging-disabled');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { Client } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. RELATIONAL DATABASE SETUP
// ==========================================
const client = new Client({
    user: 'postgres', password: 'root', host: 'localhost', port: 5432, database: 'brain_db',
});

async function initDB() {
    await client.connect();
    // Table 1: The Chat Rooms
    await client.query(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    // Table 2: The Messages (Linked to the Chat Room)
    await client.query(`
        CREATE TABLE IF NOT EXISTS session_messages (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
            role VARCHAR(10) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log("🗄️ Relational Database schemas ready.");
}
initDB();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'documents');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage: storage });
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });

// ==========================================
// 2. SESSION & HISTORY API
// ==========================================
app.get('/api/sessions', async (req, res) => {
    try {
        const result = await client.query(`SELECT id, title FROM chat_sessions ORDER BY id DESC`);
        res.json({ sessions: result.rows });
    } catch (error) {
        res.status(500).json({ error: "Failed to load sessions." });
    }
});

app.get('/api/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const result = await client.query(
            `SELECT role, content FROM session_messages WHERE session_id = $1 ORDER BY id ASC`, 
            [sessionId]
        );
        res.json({ history: result.rows });
    } catch (error) {
        res.status(500).json({ error: "Failed to load history." });
    }
});

// ==========================================
// 3. CORE RAG CHAT ENGINE
// ==========================================
app.post('/api/chat', async (req, res) => {
    try {
        let { question, model, sessionId } = req.body;
        console.log(`\n🗣️ Query: "${question}" | Session: ${sessionId || 'NEW'}`);

        // A. If no session exists, create one and generate a title
        if (!sessionId) {
            const title = question.length > 30 ? question.substring(0, 30) + '...' : question;
            const sessionRes = await client.query(
                `INSERT INTO chat_sessions (title) VALUES ($1) RETURNING id`, [title]
            );
            sessionId = sessionRes.rows[0].id;
        }

        // B. Save User Question to specific session
        await client.query(
            `INSERT INTO session_messages (session_id, role, content) VALUES ($1, 'user', $2)`, 
            [sessionId, question]
        );

        // C. Embed & Vector Search
        const embedRes = await fetch('http://localhost:11434/api/embeddings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'nomic-embed-text', prompt: question })
        });
        const embedData = await embedRes.json();
        const vector = `[${embedData.embedding.join(',')}]`;

        const dbResult = await client.query(
            `SELECT chunk_text FROM memory_chunks ORDER BY embedding <=> $1 LIMIT 1;`, [vector]
        );
        const retrievedContext = dbResult.rows.length > 0 ? dbResult.rows[0].chunk_text : "No context found.";

        // D. Retrieve Short-term Memory for THIS specific session
        const historyRes = await client.query(`
            SELECT role, content FROM (
                SELECT role, content, id FROM session_messages WHERE session_id = $1 ORDER BY id DESC LIMIT 6
            ) sub ORDER BY id ASC;
        `, [sessionId]);
        
        const historyString = historyRes.rows
            .filter(row => row.content !== question)
            .map(row => `${row.role === 'user' ? 'User' : 'Assistant'}: ${row.content}`)
            .join('\n');

        // E. Super Prompt
        const superPrompt = `
            You are a highly accurate assistant. 
            [DOCUMENT CONTEXT]
            Use ONLY the following context to answer technical questions. If the answer is not in the context, say "I don't know."
            ${retrievedContext}
            
            [RECENT CONVERSATION HISTORY]
            ${historyString}
            
            [CURRENT QUESTION]
            User: ${question}
            Assistant:
        `;

        // F. Generate Answer
        const chatRes = await fetch('http://localhost:11434/api/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model, prompt: superPrompt, stream: false })
        });
        const chatData = await chatRes.json();

        // G. Save AI Answer
        await client.query(
            `INSERT INTO session_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`, 
            [sessionId, chatData.response]
        );

        // Return the answer AND the sessionId (so React knows which chat it just created)
        res.json({ answer: chatData.response, sessionId: sessionId });
    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ error: "Brain malfunctioned." });
    }
});

// ==========================================
// 4. UPLOAD & MODEL MANAGEMENT (Unchanged)
// ==========================================
app.post('/api/upload', upload.single('document'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file uploaded." });

        let rawText = file.originalname.endsWith('.txt') 
            ? fs.readFileSync(file.path, 'utf-8') 
            : (await pdfParse(fs.readFileSync(file.path))).text;

        const chunks = await splitter.createDocuments([rawText]);

        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i].pageContent;
            const embedRes = await fetch('http://localhost:11434/api/embeddings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'nomic-embed-text', prompt: chunkText })
            });
            const vector = `[${(await embedRes.json()).embedding.join(',')}]`;

            await client.query(
                `INSERT INTO memory_chunks (source_file, chunk_text, embedding) VALUES ($1, $2, $3)`,
                [file.originalname, chunkText, vector]
            );
        }
        res.json({ message: "File vectorized!" });
    } catch (error) { res.status(500).json({ error: "Ingestion failed." }); }
});

app.get('/api/models', async (req, res) => {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        res.json({ models: data.models.filter(m => m.name !== 'nomic-embed-text:latest') });
    } catch (error) { res.status(500).json({ error: "Could not reach Ollama." }); }
});

app.post('/api/pull', async (req, res) => {
    try {
        await fetch('http://localhost:11434/api/pull', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: req.body.model, stream: false })
        });
        res.json({ message: "Model pulled successfully." });
    } catch (error) { res.status(500).json({ error: "Failed to pull model." }); }
});

app.listen(3000, () => console.log("🚀 Session-based Brain API running on http://localhost:3000"));