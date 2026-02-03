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
  AlertCircle,
  FileText,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
        showToast("Welcome back! Continuing your reading session.");
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
    setTimeout(() => setStatusMessage(""), 5000);
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
    showToast("Gemini is processing your PDF. This may take a moment...");
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(',')[1];
      try {
        const result = await processPDF(base64);
        setBook({
          id: Date.now().toString(),
          title: result.title || "Untitled Document",
          author: result.author || "Unknown Author",
          chapters: result.chapters.map((c, i) => ({ ...c, id: i.toString() })),
          bookmarks: [],
          lastPlayedChapter: 0,
          lastPlayedTime: 0
        });
        setCurrentChapterIndex(0);
        pausedAtRef.current = 0;
        setCurrentTime(0);
        audioBufferRef.current = null;
        showToast("Book processed successfully!");
      } catch (err) {
        showToast("Could not process PDF. Please check your connection or try a different file.");
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
    try {
      const pcm = await generateSpeech(book.chapters[idx].content);
      const buffer = await decodeAudioData(pcm, audioContextRef.current!);
      audioBufferRef.current = buffer;
      setDuration(buffer.duration);
      pausedAtRef.current = seek;
      setCurrentTime(seek);
      return buffer;
    } catch (err) {
      showToast("Narration generation failed. Please try again.");
      return null;
    } finally {
      setIsLoadingAudio(false);
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
      // Auto-bookmark on pause to ensure user never loses place
      saveAutoBookmark();
    } else {
      if (!audioBufferRef.current) {
        const buffer = await loadAudio(currentChapterIndex, pausedAtRef.current);
        if (buffer) playBuffer(buffer, pausedAtRef.current);
      } else {
        playBuffer(audioBufferRef.current, pausedAtRef.current);
      }
    }
  };

  const saveAutoBookmark = () => {
    if (!book) return;
    const b: Bookmark = {
      id: "auto-" + Date.now().toString(),
      title: `Last Position: ${book.chapters[currentChapterIndex].title}`,
      chapterIndex: currentChapterIndex,
      timestamp: currentTime,
      textSnippet: "Resume from your last position...",
      createdAt: Date.now()
    };
    // Keep only one auto-bookmark at the top
    const otherBookmarks = book.bookmarks.filter(bm => !bm.id.startsWith("auto-"));
    setBook({ ...book, bookmarks: [b, ...otherBookmarks] });
  };

  const navigateToBookmark = async (b: Bookmark) => {
    stopAudio();
    setCurrentChapterIndex(b.chapterIndex);
    pausedAtRef.current = b.timestamp;
    setCurrentTime(b.timestamp);
    const buffer = await loadAudio(b.chapterIndex, b.timestamp);
    if (buffer) playBuffer(buffer, b.timestamp);
    showToast(`Resumed at ${formatTime(b.timestamp)}`);
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

  const addManualBookmark = () => {
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
    if(confirm("Permanently remove this book from your library?")) {
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
            <motion.div 
              whileHover={{ rotate: 10, scale: 1.1 }}
              className="icon-box"
            >
              <BookOpen size={20} />
            </motion.div>
            <h1>AuraReader</h1>
          </div>
          <div className="header-actions">
            {book && (
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="icon-btn delete" 
                onClick={clearBook} 
                title="Delete Book"
              >
                <Trash2 size={18} />
              </motion.button>
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
              <span>{book ? "Swap Book" : "Upload PDF"}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <AnimatePresence mode="wait">
          {isProcessing ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="loading-state"
            >
              <Loader2 className="spinning" size={56} color="#4f46e5" />
              <h2>Preparing your Experience</h2>
              <p>Gemini is transcribing and structuring your document...</p>
            </motion.div>
          ) : !book ? (
            <motion.div 
              key="empty"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="empty-state"
            >
              <div className="hero-icon">
                <FileText size={48} />
              </div>
              <h2>Ready for a new story?</h2>
              <p>Turn your dry PDF documents into immersive audiobooks. Powered by Google Gemini's advanced narration.</p>
              <Button onClick={() => fileInputRef.current?.click()} size="lg">
                Choose a PDF to begin
              </Button>
            </motion.div>
          ) : (
            <motion.div 
              key="player"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="player-layout"
            >
              <section className="player-card">
                <div className="book-meta">
                  <motion.div 
                    initial={{ scale: 0.8 }} 
                    animate={{ scale: 1 }}
                    className="cover-art"
                  >
                    {isPlaying ? <Volume2 size={40} className="pulse" /> : <BookOpen size={40} />}
                  </motion.div>
                  <div className="meta-info">
                    <h2>{book.title}</h2>
                    <p>{book.author}</p>
                  </div>
                </div>

                <div className="playback-controls">
                  <div className="progress-container">
                    <div className="progress-bar">
                      <motion.div 
                        className="progress-fill" 
                        animate={{ width: `${(currentTime/duration)*100 || 0}%` }}
                        transition={{ duration: 0.1, ease: "linear" }}
                      />
                    </div>
                    <div className="time-info">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  <div className="buttons-row">
                    <div className="spacer" />
                    <motion.button 
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                      className="play-pause" 
                      onClick={togglePlay} 
                      disabled={isLoadingAudio}
                    >
                      {isLoadingAudio ? <Loader2 className="spinning" /> : (isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />)}
                    </motion.button>
                    <motion.button 
                      whileHover={{ backgroundColor: '#ede9fe' }}
                      className="bookmark-btn" 
                      onClick={addManualBookmark}
                    >
                      <BookmarkIcon size={18} />
                      <span>Bookmark</span>
                    </motion.button>
                  </div>
                </div>
              </section>

              <section className="bookmarks-section">
                <h3>Resuming Points</h3>
                {book.bookmarks.length === 0 ? (
                  <div className="no-items">Pick up exactly where you left off by saving a bookmark.</div>
                ) : (
                  <div className="bookmarks-grid">
                    {book.bookmarks.map(b => (
                      <motion.div 
                        key={b.id} 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        whileHover={{ y: -4, borderColor: '#4f46e5' }}
                        className={`bookmark-card ${b.id.startsWith('auto-') ? 'auto-bm' : ''}`} 
                        onClick={() => navigateToBookmark(b)}
                      >
                        <div className="b-header">
                          {b.id.startsWith('auto-') ? <RotateCcw size={12} /> : <Clock size={12} />}
                          <span>{b.title}</span>
                        </div>
                        <p className="b-snippet">{b.textSnippet.length > 75 ? `"${b.textSnippet.substring(0, 75)}..."` : b.textSnippet}</p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </section>

              <section className="chapters-section">
                <h3>Table of Contents</h3>
                <div className="chapters-list">
                  {book.chapters.map((c, i) => {
                    const isActive = i === currentChapterIndex;
                    return (
                      <motion.button 
                        key={c.id} 
                        whileHover={{ x: 5 }}
                        className={`chapter-item ${isActive ? 'active' : ''}`}
                        onClick={() => navigateToChapter(i)}
                      >
                        <div className="c-info">
                          <span className="c-num">{String(i + 1).padStart(2, '0')}</span>
                          <span className="c-title">{c.title}</span>
                        </div>
                        <ChevronRight size={18} />
                      </motion.button>
                    );
                  })}
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {statusMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, scale: 0.95, x: '-50%' }}
            className="toast-notification"
          >
            <AlertCircle size={18} />
            <span>{statusMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .app-container { min-height: 100vh; display: flex; flex-direction: column; background: #f8fafc; }
        .app-header { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 50; }
        .header-content { max-width: 1000px; margin: 0 auto; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; }
        .logo { display: flex; align-items: center; gap: 0.75rem; cursor: default; }
        .logo h1 { font-size: 1.25rem; font-weight: 800; color: var(--text-main); margin: 0; letter-spacing: -0.04em; }
        .icon-box { background: var(--primary); color: white; padding: 0.5rem; border-radius: 0.85rem; display: flex; }
        .header-actions { display: flex; align-items: center; gap: 1rem; }
        
        .main-content { max-width: 800px; margin: 0 auto; width: 100%; padding: 2.5rem 1.5rem; flex: 1; }
        
        .empty-state { text-align: center; padding: 5rem 2rem; background: white; border-radius: 2.5rem; border: 2px dashed #cbd5e1; margin-top: 1rem; }
        .hero-icon { background: #f0f0ff; color: var(--primary); width: 110px; height: 110px; border-radius: 2.5rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 2.5rem; transform: rotate(-5deg); }
        .empty-state h2 { font-size: 2rem; font-weight: 800; margin-bottom: 1rem; color: #1e293b; }
        .empty-state p { color: var(--text-sub); margin-bottom: 3rem; line-height: 1.7; max-width: 480px; margin-left: auto; margin-right: auto; font-size: 1.1rem; }
        
        .loading-state { text-align: center; padding: 6rem 2rem; background: white; border-radius: 2.5rem; border: 1px solid var(--border); }
        .spinning { animation: spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite; }
        .loading-state h2 { margin-top: 2rem; font-weight: 800; }
        .loading-state p { color: var(--text-sub); margin-top: 0.75rem; }

        .player-layout { display: flex; flex-direction: column; gap: 3rem; }
        .player-card { background: white; padding: 3rem; border-radius: 3rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.06); border: 1px solid var(--border); position: relative; overflow: hidden; }
        .player-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 6px; background: linear-gradient(90deg, #4f46e5, #818cf8); }
        
        .book-meta { display: flex; gap: 2rem; margin-bottom: 2.5rem; align-items: flex-start; }
        .cover-art { width: 90px; height: 120px; background: var(--primary); border-radius: 1.25rem; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; box-shadow: 0 15px 30px -10px rgba(79, 70, 229, 0.5); position: relative; overflow: hidden; }
        .meta-info h2 { font-size: 1.75rem; font-weight: 800; margin: 0 0 0.5rem 0; line-height: 1.15; letter-spacing: -0.03em; color: #1e293b; }
        .meta-info p { font-size: 1.1rem; color: var(--text-sub); margin: 0; font-weight: 600; }

        .progress-container { margin-bottom: 1rem; }
        .progress-bar { height: 10px; background: #f1f5f9; border-radius: 10px; overflow: hidden; margin-bottom: 0.75rem; position: relative; cursor: pointer; }
        .progress-fill { height: 100%; background: var(--primary); border-radius: 10px; box-shadow: 0 0 10px rgba(79, 70, 229, 0.4); }
        .time-info { display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-sub); font-weight: 800; font-family: 'JetBrains Mono', monospace; }
        
        .buttons-row { display: flex; align-items: center; justify-content: space-between; margin-top: 2.5rem; }
        .play-pause { width: 84px; height: 84px; border-radius: 50%; background: var(--primary); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s; box-shadow: 0 15px 35px -10px rgba(79, 70, 229, 0.6); }
        .play-pause:hover { background: var(--primary-hover); }
        .play-pause:disabled { background: #cbd5e1; box-shadow: none; cursor: wait; }
        .bookmark-btn { display: flex; align-items: center; gap: 0.6rem; padding: 0.9rem 1.6rem; background: #f3f4ff; color: var(--primary); border: none; border-radius: 1.25rem; cursor: pointer; font-weight: 800; font-size: 0.95rem; transition: all 0.2s; }

        .chapters-section h3, .bookmarks-section h3 { font-size: 1.4rem; font-weight: 800; margin-bottom: 1.5rem; letter-spacing: -0.02em; }
        .chapters-list { display: flex; flex-direction: column; gap: 0.85rem; }
        .chapter-item { display: flex; align-items: center; justify-content: space-between; background: white; border: 1px solid var(--border); padding: 1.4rem 1.6rem; border-radius: 1.5rem; cursor: pointer; text-align: left; transition: all 0.25s; }
        .chapter-item.active { background: var(--primary); border-color: var(--primary); color: white; box-shadow: 0 10px 20px -5px rgba(79, 70, 229, 0.3); }
        .c-info { display: flex; align-items: center; gap: 1.25rem; }
        .c-num { font-weight: 800; font-size: 0.85rem; opacity: 0.4; width: 30px; letter-spacing: 0.05em; }
        .c-title { font-weight: 700; font-size: 1rem; }

        .bookmarks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.25rem; }
        .bookmark-card { background: white; border: 1px solid var(--border); padding: 1.5rem; border-radius: 1.75rem; cursor: pointer; transition: all 0.25s; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); }
        .bookmark-card.auto-bm { border-left: 4px solid var(--primary); background: #f8fafc; }
        .b-header { display: flex; align-items: center; gap: 0.6rem; color: var(--primary); font-weight: 800; font-size: 0.75rem; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .b-snippet { font-size: 0.9rem; color: var(--text-sub); line-height: 1.6; font-style: italic; margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

        .icon-btn { border: none; background: transparent; cursor: pointer; padding: 0.6rem; border-radius: 0.75rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .icon-btn.delete { color: #f43f5e; }
        .icon-btn.delete:hover { background: #fff1f2; }

        .toast-notification { position: fixed; bottom: 2.5rem; left: 50%; background: #0f172a; color: white; padding: 1.25rem 2rem; border-radius: 1.5rem; display: flex; align-items: center; gap: 1rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); z-index: 1000; font-weight: 700; font-size: 0.95rem; min-width: 320px; justify-content: center; pointer-events: none; }
        
        .no-items { padding: 3rem; text-align: center; border: 1px dashed var(--border); border-radius: 2rem; color: var(--text-sub); background: rgba(255,255,255,0.5); font-weight: 500; }

        .pulse { animation: pulseAnim 2s infinite; }
        @keyframes pulseAnim { 
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.8; }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @media (max-width: 640px) {
          .main-content { padding: 1.5rem; }
          .player-card { padding: 2rem; }
          .book-meta { flex-direction: column; text-align: center; align-items: center; gap: 1.25rem; }
          .bookmarks-grid { grid-template-columns: 1fr; }
          .play-pause { width: 72px; height: 72px; }
          .header-content h1 { display: none; }
        }
      `}</style>
    </div>
  );
};

export default App;