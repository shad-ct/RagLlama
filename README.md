# 🦙 RagLlama

A 100% local, fully private Retrieval-Augmented Generation (RAG) AI application. RagLlama allows you to upload personal documents (PDFs/TXTs) and chat with them using local LLMs. Zero data leaves your machine.

![UI Aesthetic](https://img.shields.io/badge/UI-shadcn%2Fui_inspired-zinc?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-React_%7C_Express_%7C_PostgreSQL-blue?style=flat-square)
![AI](https://img.shields.io/badge/AI-Ollama-white?style=flat-square)



## What It Is
RagLlama bridges the gap between your local file system and open-weight AI models. It ingests your documents, slices them into context-aware chunks, maps them into a 768-dimensional vector space using mathematically calculated embeddings, and stores them in a native PostgreSQL vault. 

When you ask a question, the system searches the vault using **Cosine Similarity**, injects the most relevant context into the LLM's prompt, and generates a highly accurate, hallucination-free response.

## Features
* **Absolute Privacy:** Runs entirely on your local hardware. No API keys, no cloud servers.
* **Smart File Ingestion:** Upload `.txt` or `.pdf` files directly via the UI. The backend automatically parses, chunks, and vectorizes the text on the fly.
* **Relational Chat History:** Features isolated chat sessions. Short-term conversational memory is injected into the prompt alongside long-term document memory.
* **Model Management Proxy:** A built-in Ollama proxy allows you to browse installed models and download new ones (e.g., `llama3`, `mistral`, `phi3`) directly from the web dashboard.
* **Minimalist UI:** Built with React and styled with a strict, dark-themed `shadcn/ui` aesthetic.

---

## Prerequisites (The "What")

Before running this project, you need the underlying infrastructure installed on your machine:

1. **[Node.js](https://nodejs.org/)** (v18 or higher)
2. **[Ollama](https://ollama.com/)** (Running locally on port `11434`)
   * *Required initial model:* Open your terminal and run `ollama pull nomic-embed-text` (used for the math/vector embeddings).
3. **PostgreSQL + `pgvector`**
   * **Option A (Docker - Recommended):** ```bash
     docker run --name brain-db -e POSTGRES_PASSWORD=root -p 5432:5432 -d pgvector/pgvector:pg18
     ```
   * **Option B (Native Windows Compile):** You must have PostgreSQL 18 installed, along with Microsoft C++ Build Tools, and manually compile the `pgvector` extension against your Postgres headers.

---

## Installation & Setup (The "How")

### 1. Database Initialization
Ensure your Postgres server is running. Open your `psql` terminal (`psql -U postgres -h localhost`) and run:
```sql
CREATE DATABASE brain_db;
\c brain_db
CREATE EXTENSION vector;
```
*(Note: The Node.js backend handles all table creations and auto-migrations for you.)*

### 2. Backend Setup
The Express server acts as the proxy, file manager, and database controller.
```bash
# From the root directory
npm install
node server.js
```


The server will start on http://localhost:3000 and automatically build your relational tables.

3. Frontend Setup
The React application acts as the client-side dashboard. Open a new terminal window:

Bash
```
cd client
npm install
npm run dev
```

The UI will be accessible at http://localhost:5173.

## Technical Architecture

* **The Slicer Engine:** Uses `@langchain/textsplitters` (`RecursiveCharacterTextSplitter`) to chunk documents with a 200-character overlap. This prevents the "smoothie effect" and ensures context isn't destroyed when paragraphs are sliced.
* **The Vector Vault:** Uses raw `pg` (`node-postgres`) queries. `pgvector` utilizes the `<=>` operator to calculate Cosine Distance at lightning speed.
* **The Tri-Layer Prompt:** The `/api/chat` endpoint constructs a strict prompt containing:
  1. The localized vector context (Long-term memory).
  2. The recent session messages (Short-term memory).
  3. The immediate user query.
* **Multer Middleware:** Safely handles incoming binary `multipart/form-data` from the React frontend, saving PDFs directly to the physical `/documents` folder before vectorization.

