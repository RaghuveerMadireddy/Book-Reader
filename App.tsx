
import React, { useState, useRef, useEffect } from 'react';
import { 
  BookOpen, 
  Play, 
  Pause, 
  Bookmark as BookmarkIcon, 
  Trash2, 
  Upload, 
  ChevronRight,
  Clock,
  Volume2,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { processPDF, generateSpeech, decodeAudioData } from './services/geminiService';
import { Book, Bookmark } from './types';
import { Button } from './components/Button';

const STORAGE_KEY = "aura_reader_current_book";

const App: React.FC = () => {
  const [book, setBook] = useState<Book | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsedBook = JSON.parse(saved) as Book;
        setBook(parsedBook);
        setCurrentChapterIndex(parsedBook.lastPlayedChapter || 0);
        pausedAtRef.current = parsedBook.lastPlayedTime || 0;
        setCurrentTime(parsedBook.lastPlayedTime || 0);
        showToast("Welcome back! Your session has been restored.");
      } catch (e) {
        console.error("Failed to restore", e);
      }
    }
  }, []);

  useEffect(() => {
    if (book) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...book,
        lastPlayedChapter: currentChapterIndex,
        lastPlayedTime: currentTime
      }));
    }
  }, [book, currentChapterIndex, currentTime]);

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(""), 4000);
  };

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    showToast("Gemini is analyzing your PDF...");
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(',')[1];
      try {
        const result = await processPDF(base64);
        setBook({
          id: Date.now().toString(),
          title: result.title,
          author: result.author,
          chapters: result.chapters.map((c, i) => ({ ...c, id: i.toString() })),
          bookmarks: [],
          lastPlayedChapter: 0,
          lastPlayedTime: 0
        });
        setCurrentChapterIndex(0);
        pausedAtRef.current = 0;
        setCurrentTime(0);
        audioBufferRef.current = null;
      } catch (err) {
        showToast("Analysis failed. Please try a different PDF.");
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const loadAudio = async (idx: number, seek: number = 0): Promise<AudioBuffer | null> => {
    if (!book) return null;
    initAudio();
    setIsLoadingAudio(true);
    setLoadingIndex(idx);
    try {
      const pcm = await generateSpeech(book.chapters[idx].content);
      const buffer = await decodeAudioData(pcm, audioContextRef.current!);
      audioBufferRef.current = buffer;
      setDuration(buffer.duration);
      pausedAtRef.current = seek;
      setCurrentTime(seek);
      return buffer;
    } catch (err) {
      showToast("Narration failed. Check your API key.");
      return null;
    } finally {
      setIsLoadingAudio(false);
      setLoadingIndex(null);
    }
  };

  const playBuffer = (buffer: AudioBuffer, offset: number) => {
    if (!audioContextRef.current) return;
    stopAudio();
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    const actualOffset = Math.max(0, Math.min(offset, buffer.duration - 0.1));
    source.start(0, actualOffset);
    startTimeRef.current = audioContextRef.current.currentTime - actualOffset;
    sourceNodeRef.current = source;
    setIsPlaying(true);
  };

  const togglePlay = async () => {
    if (isPlaying) {
      if (audioContextRef.current) {
        pausedAtRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      }
      stopAudio();
    } else {
      if (!audioBufferRef.current) {
        const buffer = await loadAudio(currentChapterIndex, pausedAtRef.current);
        if (buffer) playBuffer(buffer, pausedAtRef.current);
      } else {
        playBuffer(audioBufferRef.current, pausedAtRef.current);
      }
    }
  };

  const navigateToChapter = async (index: number) => {
    if (index === currentChapterIndex && audioBufferRef.current) {
      togglePlay();
      return;
    }
    stopAudio();
    setCurrentChapterIndex(index);
    pausedAtRef.current = 0;
    setCurrentTime(0);
    const buffer = await loadAudio(index, 0);
    if (buffer) playBuffer(buffer, 0);
  };

  const addBookmark = () => {
    if (!book) return;
    const b: Bookmark = {
      id: Date.now().toString(),
      title: `${book.chapters[currentChapterIndex].title} @ ${formatTime(currentTime)}`,
      chapterIndex: currentChapterIndex,
      timestamp: currentTime,
      textSnippet: book.chapters[currentChapterIndex].content.substring(0, 100),
      createdAt: Date.now()
    };
    setBook({ ...book, bookmarks: [b, ...book.bookmarks] });
    showToast("Bookmark saved!");
  };

  const clearBook = () => {
    if(confirm("Are you sure you want to delete this book?")) {
      stopAudio();
      setBook(null);
      localStorage.removeItem(STORAGE_KEY);
      showToast("Library cleared.");
    }
  };

  useEffect(() => {
    let interval: number;
    if (isPlaying && audioContextRef.current) {
      interval = window.setInterval(() => {
        const now = audioContextRef.current!.currentTime - startTimeRef.current;
        setCurrentTime(Math.min(now, duration));
        if (now >= duration && duration > 0) {
          setIsPlaying(false);
          setCurrentTime(duration);
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <div className="icon-box"><BookOpen size={20} /></div>
            <h1>AuraReader</h1>
          </div>
          <div className="header-actions">
            {book && (
              <button className="icon-btn delete" onClick={clearBook} title="Delete Book">
                <Trash2 size={18} />
              </button>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept="application/pdf" 
              onChange={handleUpload} 
            />
            <Button onClick={() => fileInputRef.current?.click()} variant="primary" size="sm" isLoading={isProcessing}>
              <Upload size={16} />
              <span>{book ? "Change Book" : "Upload PDF"}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="main-content">
        {isProcessing ? (
          <div className="loading-state">
            <Loader2 className="spinning" size={48} color="#4f46e5" />
            <p>Gemini is reading your book and generating chapters...</p>
          </div>
        ) : !book ? (
          <div className="empty-state">
            <div className="hero-icon"><BookOpen size={64} /></div>
            <h2>Start your listening journey</h2>
            <p>Upload any PDF and Gemini will transform it into a narrated audiobook experience with smart bookmarking.</p>
            <Button onClick={() => fileInputRef.current?.click()} size="lg">Get Started</Button>
          </div>
        ) : (
          <div className="player-layout">
            <section className="player-card">
              <div className="book-meta">
                <div className="cover-art">
                  <Volume2 size={40} />
                </div>
                <div className="meta-info">
                  <h2>{book.title}</h2>
                  <p>{book.author}</p>
                </div>
              </div>

              <div className="playback-controls">
                <div className="progress-container">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${(currentTime/duration)*100 || 0}%` }} 
                    />
                  </div>
                  <div className="time-info">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>

                <div className="buttons-row">
                  <div className="spacer" />
                  <button className="play-pause" onClick={togglePlay} disabled={isLoadingAudio}>
                    {isLoadingAudio ? <Loader2 className="spinning" /> : (isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />)}
                  </button>
                  <button className="bookmark-btn" onClick={addBookmark}>
                    <BookmarkIcon size={18} />
                    <span>Bookmark</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="bookmarks-section">
              <h3>Saved Bookmarks</h3>
              {book.bookmarks.length === 0 ? (
                <div className="no-items">No bookmarks yet. Tap the bookmark button while listening.</div>
              ) : (
                <div className="bookmarks-grid">
                  {book.bookmarks.map(b => (
                    <div key={b.id} className="bookmark-card" onClick={() => navigateToChapter(b.chapterIndex)}>
                      <div className="b-header">
                        <Clock size={12} />
                        <span>{b.title}</span>
                      </div>
                      <p className="b-snippet">"{b.textSnippet.substring(0, 80)}..."</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="chapters-section">
              <h3>Chapters</h3>
              <div className="chapters-list">
                {book.chapters.map((c, i) => {
                  const isActive = i === currentChapterIndex;
                  return (
                    <button 
                      key={c.id} 
                      className={`chapter-item ${isActive ? 'active' : ''}`}
                      onClick={() => navigateToChapter(i)}
                    >
                      <div className="c-info">
                        <span className="c-num">{i + 1}</span>
                        <span className="c-title">{c.title}</span>
                      </div>
                      <ChevronRight size={18} />
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </main>

      {statusMessage && (
        <div className="toast-notification">
          <AlertCircle size={18} />
          <span>{statusMessage}</span>
        </div>
      )}

      <style>{`
        .app-container { min-height: 100vh; display: flex; flex-direction: column; }
        .app-header { background: white; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 50; }
        .header-content { max-width: 1000px; margin: 0 auto; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; }
        .logo { display: flex; align-items: center; gap: 0.75rem; }
        .logo h1 { font-size: 1.25rem; font-weight: 800; color: var(--text-main); margin: 0; letter-spacing: -0.025em; }
        .icon-box { background: var(--primary); color: white; padding: 0.5rem; borderRadius: 0.75rem; display: flex; }
        .header-actions { display: flex; align-items: center; gap: 1rem; }
        
        .main-content { max-width: 800px; margin: 0 auto; width: 100%; padding: 2rem 1.5rem; flex: 1; }
        
        .empty-state { text-align: center; padding: 4rem 2rem; background: white; border-radius: 2rem; border: 2px dashed var(--border); margin-top: 2rem; }
        .hero-icon { background: #f5f3ff; color: var(--primary); width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 2rem; }
        .empty-state h2 { font-size: 1.75rem; font-weight: 800; margin-bottom: 1rem; }
        .empty-state p { color: var(--text-sub); margin-bottom: 2.5rem; line-height: 1.6; max-width: 400px; margin-left: auto; margin-right: auto; }
        
        .loading-state { text-align: center; padding: 6rem 2rem; }
        .spinning { animation: spin 1s linear infinite; }
        .loading-state p { margin-top: 1.5rem; color: var(--primary); font-weight: 600; }

        .player-layout { display: flex; flex-direction: column; gap: 2.5rem; }
        .player-card { background: white; padding: 2.5rem; border-radius: 2.5rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.05); border: 1px solid var(--border); }
        .book-meta { display: flex; gap: 1.5rem; margin-bottom: 2rem; }
        .cover-art { width: 80px; height: 110px; background: var(--primary); border-radius: 1rem; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.4); }
        .meta-info h2 { font-size: 1.5rem; font-weight: 800; margin: 0 0 0.25rem 0; line-height: 1.2; }
        .meta-info p { font-size: 1rem; color: var(--text-sub); margin: 0; font-weight: 500; }

        .progress-bar { height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; margin-bottom: 0.75rem; position: relative; }
        .progress-fill { height: 100%; background: var(--primary); transition: width 0.1s linear; }
        .time-info { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-sub); font-weight: 700; font-family: monospace; }
        
        .buttons-row { display: flex; align-items: center; justify-content: space-between; margin-top: 2rem; }
        .play-pause { width: 72px; height: 72px; border-radius: 50%; background: var(--primary); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; box-shadow: 0 10px 20px rgba(79, 70, 229, 0.3); }
        .play-pause:hover { transform: scale(1.05); }
        .play-pause:active { transform: scale(0.95); }
        .bookmark-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.25rem; background: #f5f3ff; color: var(--primary); border: none; border-radius: 1rem; cursor: pointer; font-weight: 700; font-size: 0.875rem; }
        .bookmark-btn:hover { background: #ede9fe; }

        .chapters-section h3, .bookmarks-section h3 { font-size: 1.25rem; font-weight: 800; margin-bottom: 1.25rem; }
        .chapters-list { display: flex; flex-direction: column; gap: 0.75rem; }
        .chapter-item { display: flex; align-items: center; justify-content: space-between; background: white; border: 1px solid var(--border); padding: 1.25rem; border-radius: 1.25rem; cursor: pointer; text-align: left; transition: all 0.2s; }
        .chapter-item:hover { border-color: var(--primary); transform: translateX(4px); }
        .chapter-item.active { background: var(--primary); border-color: var(--primary); color: white; }
        .c-info { display: flex; align-items: center; gap: 1rem; }
        .c-num { font-weight: 800; font-size: 0.875rem; opacity: 0.5; width: 24px; }
        .c-title { font-weight: 700; }

        .bookmarks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
        .bookmark-card { background: white; border: 1px solid var(--border); padding: 1.25rem; border-radius: 1.25rem; cursor: pointer; transition: all 0.2s; }
        .bookmark-card:hover { border-color: var(--primary); background: #fafafa; }
        .b-header { display: flex; align-items: center; gap: 0.5rem; color: var(--primary); font-weight: 800; font-size: 0.75rem; margin-bottom: 0.5rem; }
        .b-snippet { font-size: 0.875rem; color: var(--text-sub); line-height: 1.5; font-style: italic; margin: 0; }

        .icon-btn { border: none; background: transparent; cursor: pointer; padding: 0.5rem; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; }
        .icon-btn.delete { color: #ef4444; }
        .icon-btn.delete:hover { background: #fee2e2; }

        .toast-notification { position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 1rem 1.5rem; border-radius: 1rem; display: flex; align-items: center; gap: 0.75rem; box-shadow: 0 10px 15px rgba(0,0,0,0.2); animation: slideUp 0.3s ease-out; z-index: 100; font-weight: 600; font-size: 0.875rem; }
        
        @keyframes slideUp { from { transform: translate(-50%, 100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @media (max-width: 640px) {
          .main-content { padding: 1rem; }
          .player-card { padding: 1.5rem; }
          .book-meta { flex-direction: column; text-align: center; align-items: center; }
          .bookmarks-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};

export default App;
