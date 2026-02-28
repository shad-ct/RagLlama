import { useState, useEffect, useRef } from 'react';
import { Send, UploadCloud, DownloadCloud, RefreshCw, PlusCircle, MessageSquare } from 'lucide-react';
import './App.css';

function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  
  const [input, setInput] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('llama3');
  const [newModelName, setNewModelName] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [file, setFile] = useState(null);
  const [isThinking, setIsThinking] = useState(false);

  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  useEffect(() => {
    fetchModels();
    fetchSessions();
  }, []);

  // Fetch all chat threads for the sidebar
  const fetchSessions = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/sessions');
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (e) { console.error("Could not fetch sessions."); }
  };

  // Load a specific chat thread when clicked
  const loadSession = async (sessionId) => {
    setActiveSessionId(sessionId);
    try {
      const res = await fetch(`http://localhost:3000/api/history/${sessionId}`);
      const data = await res.json();
      setMessages(data.history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'ai',
        content: msg.content
      })));
    } catch (e) { console.error("Could not load history."); }
  };

  const createNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
  };

  const fetchModels = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/models');
      const data = await res.json();
      setModels(data.models || []);
    } catch (e) { console.error("Could not fetch models."); }
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsThinking(true);

    try {
      const res = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question: userMessage, 
          model: selectedModel,
          sessionId: activeSessionId // Send null if it's a new chat
        })
      });
      const data = await res.json();
      
      setMessages(prev => [...prev, { role: 'ai', content: data.answer }]);
      
      // If the backend created a new session, update our state & refresh the sidebar
      if (!activeSessionId && data.sessionId) {
        setActiveSessionId(data.sessionId);
        fetchSessions(); 
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', content: 'Error: Cannot reach the Brain API.' }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleUpload = async () => { /* ... (Same as before) ... */
    if (!file) return;
    const formData = new FormData();
    formData.append('document', file);
    setUploadStatus('Uploading & chunking...');
    try {
      await fetch('http://localhost:3000/api/upload', { method: 'POST', body: formData });
      setUploadStatus('Success!'); setFile(null);
    } catch (e) { setUploadStatus('Upload failed.'); }
  };

  const handlePullModel = async () => { /* ... (Same as before) ... */
    if (!newModelName.trim()) return;
    try {
      await fetch('http://localhost:3000/api/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModelName.trim() })
      });
      setNewModelName(''); fetchModels();
    } catch (e) { console.error("Failed to pull."); }
  };

  return (
    <div className="app-container">
      
      {/* SIDEBAR: Chats & Settings */}
      <aside className="sidebar">
        
        {/* TOP HALF: Chat Sessions */}
        <div className="sidebar-section chat-list-section">
          <button onClick={createNewChat} className="primary-btn new-chat-btn">
            <PlusCircle size={16} /> New Chat
          </button>
          
          <div className="session-list">
            {sessions.map(session => (
              <div 
                key={session.id} 
                className={`session-item ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => loadSession(session.id)}
              >
                <MessageSquare size={14} /> 
                <span className="session-title">{session.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* BOTTOM HALF: Settings */}
        <div className="sidebar-section settings-section">
          <div className="sidebar-header">
            <h2>Brain Settings</h2>
          </div>

          <div className="control-group mini">
            <label>Inject Knowledge</label>
            <input type="file" accept=".pdf,.txt" onChange={(e) => setFile(e.target.files[0])} />
            <button onClick={handleUpload} disabled={!file} className="secondary-btn"><UploadCloud size={14}/> Upload</button>
            {uploadStatus && <div className="status-text">{uploadStatus}</div>}
          </div>

          <div className="control-group mini">
            <label>Active Engine</label>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              <option value="llama3">llama3</option>
              {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          </div>
        </div>
      </aside>

      {/* MAIN CHAT */}
      <main className="chat-main">
        <div className="chat-box">
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>How can I help you today?</h2>
              <p>Type a message to start a new vectorized session.</p>
            </div>
          )}
          
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role === 'user' ? 'user-msg' : 'ai-msg'}`}>
              {msg.role === 'ai' && <strong>Brain: </strong>}
              {msg.content}
            </div>
          ))}
          {isThinking && <div className="message ai-msg thinking"><em>Searching vector space...</em></div>}
          <div ref={chatEndRef} />
        </div>

        <div className="input-area">
          <input 
            type="text" placeholder="Query your local database..." 
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          <button onClick={handleSendMessage} disabled={!input.trim() || isThinking} className="primary-btn icon-btn">
            <Send size={18} /> Send
          </button>
        </div>
      </main>

    </div>
  );
}

export default App;