// src/App.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowUpIcon,
  CameraIcon,
  FileIcon,
  ImageIcon,
  Settings2Icon,
  CodeIcon,
  SearchIcon,
  MicIcon,
  BotIcon,
  UserIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  tools?: Array<{
    name: string;
    status: string;
    result?: any;
  }>;
};

type Session = {
  id: string;
  title: string;
  lastMessage?: Message;
  messageCount: number;
};

const API_BASE = '/api';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedModel, setSelectedModel] = useState('@cf/meta/llama-3.1-8b-instruct');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [showSidebar, setShowSidebar] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string>('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceWsRef = useRef<WebSocket | null>(null);

  const models = [
    { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (Fast)' },
    { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (Smart)' },
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (Fastest)' },
    { id: '@hf/nousresearch/hermes-2-pro-mistral-7b', name: 'Hermes 2 Pro' },
    { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1' }
  ];

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setIsAuthenticated(true);
      loadSessions();
      createNewSession();
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const endpoint = authMode === 'login' ? 'login' : 'signup';
    
    try {
      const response = await fetch(`${API_BASE}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password'),
          name: authMode === 'signup' ? formData.get('name') : undefined
        })
      });

      const data = await response.json();
      
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('userId', data.userId);
        setIsAuthenticated(true);
        loadSessions();
        createNewSession();
      } else {
        alert(data.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Auth error:', error);
      alert('Authentication failed. Please try again.');
    }
  };

  const loadSessions = async () => {
    try {
      const response = await fetch(`${API_BASE}/sessions`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const createNewSession = () => {
    const newSessionId = `session-${Date.now()}`;
    setSessionId(newSessionId);
    setMessages([]);
  };

  const deleteSession = async (id: string) => {
    try {
      await fetch(`${API_BASE}/sessions/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      setSessions(sessions.filter(s => s.id !== id));
      if (sessionId === id) {
        createNewSession();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          message: content,
          sessionId,
          model: selectedModel,
          useTools
        })
      });

      const data = await response.json();

      const assistantMessage: Message = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: data.response,
        timestamp: Date.now(),
        tools: data.tools
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Send message error:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const startVoiceMode = async () => {
    try {
      const ws = new WebSocket(
        `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/voice/connect`
      );

      ws.onopen = () => {
        console.log('Voice connection established');
        setIsVoiceMode(true);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'UserStartedSpeaking') {
          // Visual feedback
        } else if (data.type === 'audio') {
          // Play audio response
        }
      };

      ws.onerror = (error) => {
        console.error('Voice WebSocket error:', error);
        setIsVoiceMode(false);
      };

      ws.onclose = () => {
        setIsVoiceMode(false);
      };

      voiceWsRef.current = ws;

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorder.ondataavailable = (event) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      mediaRecorder.start(100); // Send chunks every 100ms
    } catch (error) {
      console.error('Voice mode error:', error);
      alert('Failed to start voice mode. Please check microphone permissions.');
    }
  };

  const stopVoiceMode = () => {
    if (voiceWsRef.current) {
      voiceWsRef.current.close();
      voiceWsRef.current = null;
    }
    setIsVoiceMode(false);
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(''), 2000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/files/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      const data = await response.json();
      
      if (data.success) {
        setInput(prev => `${prev}\n[File uploaded: ${file.name}](${data.url})`);
      }
    } catch (error) {
      console.error('File upload error:', error);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#faf9f5] dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="flex items-center justify-center mb-6">
            <BotIcon className="w-12 h-12 text-[#c96442]" />
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 text-gray-900 dark:text-white">
            Cloudflare AI Code Agent
          </h1>
          <p className="text-center text-gray-600 dark:text-gray-400 mb-6">
            Your intelligent coding assistant
          </p>
          
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setAuthMode('login')}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                authMode === 'login'
                  ? 'bg-[#c96442] text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setAuthMode('signup')}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                authMode === 'signup'
                  ? 'bg-[#c96442] text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'signup' && (
              <input
                type="text"
                name="name"
                placeholder="Full Name"
                required
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#c96442] outline-none"
              />
            )}
            <input
              type="email"
              name="email"
              placeholder="Email"
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#c96442] outline-none"
            />
            <input
              type="password"
              name="password"
              placeholder="Password"
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#c96442] outline-none"
            />
            <button
              type="submit"
              className="w-full bg-[#c96442] text-white py-3 rounded-lg font-medium hover:bg-[#b55538] transition-colors"
            >
              {authMode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#faf9f5] dark:bg-gray-900">
      {/* Sidebar */}
      <div className={`${showSidebar ? 'block' : 'hidden'} md:block w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col`}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={createNewSession}
            className="w-full bg-[#c96442] text-white py-2 rounded-lg font-medium hover:bg-[#b55538] transition-colors flex items-center justify-center gap-2"
          >
            <CodeIcon className="w-4 h-4" />
            New Chat
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`p-3 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group ${
                sessionId === session.id ? 'bg-gray-100 dark:bg-gray-700' : ''
              }`}
              onClick={() => setSessionId(session.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {session.title || 'New Chat'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <TrashIcon className="w-4 h-4 text-red-500" />
                </button>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {session.messageCount} messages
              </span>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => {
              localStorage.removeItem('token');
              localStorage.removeItem('userId');
              setIsAuthenticated(false);
            }}
            className="w-full text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                message.role === 'user'
                  ? 'bg-[#c96442]'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}>
                {message.role === 'user' ? (
                  <UserIcon className="w-5 h-5 text-white" />
                ) : (
                  <BotIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                )}
              </div>
              
              <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                <div className={`inline-block max-w-3xl text-left ${
                  message.role === 'user'
                    ? 'bg-[#f0eee6] dark:bg-gray-700 text-gray-900 dark:text-white rounded-2xl px-4 py-3'
                    : ''
                }`}>
                  {message.role === 'assistant' ? (
                    <div className="prose dark:prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          code({ node, inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            const codeString = String(children).replace(/\n$/, '');
                            
                            return !inline && match ? (
                              <div className="relative group">
                                <button
                                  onClick={() => copyCode(codeString)}
                                  className="absolute right-2 top-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  {copiedCode === codeString ? (
                                    <CheckIcon className="w-4 h-4 text-green-400" />
                                  ) : (
                                    <CopyIcon className="w-4 h-4 text-gray-300" />
                                  )}
                                </button>
                                <SyntaxHighlighter
                                  style={vscDarkPlus}
                                  language={match[1]}
                                  PreTag="div"
                                  {...props}
                                >
                                  {codeString}
                                </SyntaxHighlighter>
                              </div>
                            ) : (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  
                  {message.tools && (
                    <div className="mt-2 space-y-1">
                      {message.tools.map((tool, idx) => (
                        <div key={idx} className="text-xs text-gray-500 dark:text-gray-400">
                          🔧 {tool.name}: {tool.status}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <BotIcon className="w-5 h-5 text-gray-700 dark:text-gray-300 animate-pulse" />
              </div>
              <div className="flex gap-1 items-center">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="max-w-4xl mx-auto">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder="Ask me to write Cloudflare Workers code..."
                className="w-full bg-transparent text-gray-900 dark:text-white outline-none resize-none"
                rows={3}
                disabled={isLoading}
              />
              
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                      accept="image/*,.pdf,.txt,.md,.js,.ts,.tsx,.jsx,.json"
                    />
                    <FileIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </label>
                  
                  <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                    <ImageIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </button>
                  
                  <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                    <CameraIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </button>
                  
                  <button
                    onClick={isVoiceMode ? stopVoiceMode : startVoiceMode}
                    className={`p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors ${
                      isVoiceMode ? 'bg-red-100 dark:bg-red-900' : ''
                    }`}
                  >
                    <MicIcon className={`w-5 h-5 ${
                      isVoiceMode ? 'text-red-600' : 'text-gray-600 dark:text-gray-400'
                    }`} />
                  </button>
                  
                  <button
                    onClick={() => setUseTools(!useTools)}
                    className={`p-2 rounded-lg transition-colors ${
                      useTools
                        ? 'bg-[#c96442] text-white'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }`}
                    title={useTools ? 'Tools enabled' : 'Tools disabled'}
                  >
                    <Settings2Icon className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-[#c96442] outline-none"
                  >
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || isLoading}
                    className="bg-[#c96442] text-white p-3 rounded-lg hover:bg-[#b55538] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowUpIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
