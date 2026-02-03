
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { processPDF, generateSpeech, decodeAudioData } from './services/geminiService';
import { Book, Bookmark, Chapter } from './types';
import { Button } from './components/Button';

// Icons
const PlayIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>;
const PauseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>;
const BookmarkIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>;
const BookIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>;
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>;

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

  // Load saved book on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsedBook = JSON.parse(saved) as Book;
        setBook(parsedBook);
        setCurrentChapterIndex(parsedBook.lastPlayedChapter || 0);
        pausedAtRef.current = parsedBook.lastPlayedTime || 0;
        setCurrentTime(parsedBook.lastPlayedTime || 0);
        setStatusMessage("Restored your last reading session.");
        setTimeout(() => setStatusMessage(""), 3000);
      } catch (e) {
        console.error("Failed to restore book", e);
      }
    }
  }, []);

  // Persist book changes
  useEffect(() => {
    if (book) {
      const stateToSave = {
        ...book,
        lastPlayedChapter: currentChapterIndex,
        lastPlayedTime: currentTime
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    }
  }, [book, currentChapterIndex, currentTime]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMessage("Analyzing PDF with Gemini AI...");
    
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = (e.target?.result as string).split(',')[1];
        try {
          const processed = await processPDF(base64Data);
          const newBook: Book = {
            id: Math.random().toString(36).substr(2, 9),
            title: processed.title || file.name,
            author: processed.author || "Unknown Author",
            chapters: processed.chapters.map((c: any, i: number) => ({ ...c, id: i.toString() })),
            bookmarks: [],
            lastPlayedChapter: 0,
            lastPlayedTime: 0
          };
          setBook(newBook);
          setCurrentChapterIndex(0);
          pausedAtRef.current = 0;
          setCurrentTime(0);
          setStatusMessage("Processing complete!");
        } catch (err) {
          console.error(err);
          setStatusMessage("Failed to process PDF. Try a different file.");
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error(error);
      setIsProcessing(false);
      setStatusMessage("An error occurred during upload.");
    }
  };

  const loadChapterAudio = async (index: number, seekTo: number = 0) => {
    if (!book || !book.chapters[index]) return;
    
    initAudioContext();
    setIsLoadingAudio(true);
    setStatusMessage(`Generating narration for: ${book.chapters[index].title}...`);
    
    try {
      const pcmData = await generateSpeech(book.chapters[index].content);
      const buffer = await decodeAudioData(pcmData, audioContextRef.current!);
      audioBufferRef.current = buffer;
      setDuration(buffer.duration);
      
      // If we are resuming, set the pausedAt to the specific time
      pausedAtRef.current = seekTo;
      setCurrentTime(seekTo);
      setStatusMessage("");
    } catch (err) {
      console.error(err);
      setStatusMessage("Failed to generate audio for this chapter.");
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const playAudio = () => {
    if (!audioBufferRef.current || !audioContextRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.connect(audioContextRef.current.destination);
    
    const offset = Math.min(pausedAtRef.current, audioBufferRef.current.duration - 0.1);
    source.start(0, offset);
    startTimeRef.current = audioContextRef.current.currentTime - offset;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    source.onended = () => {
      if (isPlaying && currentTime >= duration - 0.5) {
        setIsPlaying(false);
        // Auto-next chapter logic could go here
      }
    };
  };

  const pauseAudio = () => {
    if (sourceNodeRef.current && audioContextRef.current) {
      sourceNodeRef.current.stop();
      pausedAtRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      sourceNodeRef.current = null;
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      if (!audioBufferRef.current) {
        loadChapterAudio(currentChapterIndex, pausedAtRef.current).then(() => playAudio());
      } else {
        playAudio();
      }
    }
  };

  const addBookmark = () => {
    if (!book) return;
    
    const currentChapter = book.chapters[currentChapterIndex];
    const newBookmark: Bookmark = {
      id: Math.random().toString(36).substr(2, 9),
      title: `${currentChapter.title} @ ${formatTime(currentTime)}`,
      chapterIndex: currentChapterIndex,
      timestamp: currentTime,
      textSnippet: currentChapter.content.substring(0, 100) + "...",
      createdAt: Date.now()
    };

    setBook({
      ...book,
      bookmarks: [newBookmark, ...book.bookmarks]
    });
    setStatusMessage("Bookmark saved!");
    setTimeout(() => setStatusMessage(""), 2000);
  };

  const jumpToBookmark = async (bookmark: Bookmark) => {
    pauseAudio();
    if (bookmark.chapterIndex !== currentChapterIndex) {
      setCurrentChapterIndex(bookmark.chapterIndex);
      await loadChapterAudio(bookmark.chapterIndex, bookmark.timestamp);
    } else {
      pausedAtRef.current = bookmark.timestamp;
      setCurrentTime(bookmark.timestamp);
    }
    playAudio();
  };

  const clearData = () => {
    if (window.confirm("Are you sure you want to clear your book and progress?")) {
      pauseAudio();
      setBook(null);
      setCurrentTime(0);
      setDuration(0);
      setCurrentChapterIndex(0);
      audioBufferRef.current = null;
      localStorage.removeItem(STORAGE_KEY);
      setStatusMessage("Library cleared.");
    }
  };

  // Sync current time UI
  useEffect(() => {
    let interval: any;
    if (isPlaying && audioContextRef.current) {
      interval = setInterval(() => {
        const now = audioContextRef.current!.currentTime - startTimeRef.current;
        setCurrentTime(Math.min(now, duration));
        if (now >= duration && duration > 0) {
          pauseAudio();
          setCurrentTime(duration);
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s]
      .map(v => v < 10 ? "0" + v : v)
      .filter((v, i) => v !== "00" || i > 0)
      .join(":");
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-5xl mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg text-white">
            <BookIcon />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">AuraReader</h1>
        </div>
        <div className="flex gap-2">
          {book && (
            <Button variant="outline" size="sm" onClick={clearData} className="text-red-500 border-red-100 hover:bg-red-50">
              <TrashIcon />
            </Button>
          )}
          {!book && !isProcessing && (
            <label className="cursor-pointer bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition font-medium shadow-sm shadow-indigo-200">
              Upload PDF
              <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
            </label>
          )}
        </div>
      </header>

      <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-8 flex-grow">
        {/* Left: Book Content & Player */}
        <div className="lg:col-span-2 space-y-6">
          {!book && !isProcessing && (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl h-96 flex flex-col items-center justify-center text-center p-8">
              <div className="bg-slate-50 p-6 rounded-full mb-4 text-indigo-500">
                <BookIcon />
              </div>
              <h2 className="text-xl font-semibold mb-2">Welcome back to AuraReader</h2>
              <p className="text-slate-500 max-w-sm mb-6">Upload any PDF book. Gemini AI will narrate it for you, and we'll remember exactly where you paused.</p>
              <Button size="lg" onClick={() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.click()}>
                Select PDF File
              </Button>
            </div>
          )}

          {isProcessing && (
            <div className="bg-white rounded-2xl p-12 border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-6"></div>
              <h2 className="text-xl font-semibold mb-2">Analyzing with Gemini AI...</h2>
              <p className="text-slate-500 animate-pulse">{statusMessage}</p>
            </div>
          )}

          {book && (
            <>
              <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 shadow-sm transition-all">
                <div className="flex flex-col md:flex-row gap-8 mb-8">
                  <div className="w-full md:w-40 h-56 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-xl shadow-indigo-100 shrink-0">
                    <div className="flex flex-col items-center gap-2">
                      <BookIcon />
                      <span className="text-[10px] font-bold tracking-widest uppercase opacity-75">AudioBook</span>
                    </div>
                  </div>
                  <div className="flex-grow flex flex-col justify-center">
                    <h2 className="text-3xl font-bold text-slate-900 mb-2 leading-tight">{book.title}</h2>
                    <p className="text-lg text-slate-500 mb-6 font-medium">{book.author}</p>
                    
                    <div className="flex items-center gap-6 text-sm text-slate-500 mb-8">
                      <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-indigo-500"></div> {book.chapters.length} Chapters</span>
                      <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> {book.bookmarks.length} Bookmarks</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-3">
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden relative">
                        <div 
                          className="bg-indigo-600 h-full transition-all duration-300 relative z-10" 
                          style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs font-mono text-slate-500 font-semibold">
                        <span className="bg-slate-100 px-2 py-0.5 rounded">{formatTime(currentTime)}</span>
                        <span className="bg-slate-100 px-2 py-0.5 rounded">{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-8">
                  <div className="flex items-center gap-5">
                    <Button 
                      variant="primary" 
                      onClick={togglePlay} 
                      isLoading={isLoadingAudio}
                      className="w-16 h-16 rounded-full p-0 flex items-center justify-center shadow-lg shadow-indigo-200 transition-transform active:scale-95"
                    >
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </Button>
                    <div>
                      <h4 className="font-bold text-slate-900 truncate max-w-[240px]">
                        {book.chapters[currentChapterIndex]?.title}
                      </h4>
                      <p className="text-xs text-slate-400 font-medium">Chapter {currentChapterIndex + 1} of {book.chapters.length}</p>
                    </div>
                  </div>

                  <Button variant="outline" onClick={addBookmark} className="gap-2 font-semibold">
                    <BookmarkIcon /> Bookmark
                  </Button>
                </div>
              </div>

              {/* Chapter Content Preview */}
              <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm relative group overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-50 px-2 py-1 rounded">TEXT PREVIEW</span>
                </div>
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-800">
                  <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  Manuscript Snippet
                </h3>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed font-serif text-lg">
                  {book.chapters[currentChapterIndex]?.content.substring(0, 800)}...
                </div>
                <div className="mt-6 pt-6 border-t border-slate-50 flex justify-center">
                  <p className="text-xs text-slate-400 italic text-center">Reading progress and bookmarks are automatically saved as you listen.</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Sidebar: Bookmarks & Chapters */}
        <div className="space-y-6">
          {book && (
            <>
              {/* Bookmarks Section */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[350px]">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-bold flex items-center gap-2 text-slate-800">
                    <BookmarkIcon /> Saved Bookmarks
                  </h3>
                  <span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded border border-slate-200">{book.bookmarks.length}</span>
                </div>
                <div className="overflow-y-auto flex-grow p-2 space-y-2 scrollbar-hide">
                  {book.bookmarks.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                      <div className="bg-slate-50 p-4 rounded-full text-slate-300">
                        <BookmarkIcon />
                      </div>
                      <p className="text-sm text-slate-400 italic">Tap "Bookmark" to save points of interest for later listening.</p>
                    </div>
                  ) : (
                    book.bookmarks.map((b) => (
                      <button 
                        key={b.id} 
                        onClick={() => jumpToBookmark(b)}
                        className="w-full text-left p-3 rounded-xl border border-transparent hover:border-indigo-100 hover:bg-indigo-50 transition group"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-sm text-slate-800 group-hover:text-indigo-700 truncate">{b.title}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight mb-1">Chapter {b.chapterIndex + 1}</p>
                        <p className="text-xs text-slate-400 truncate line-clamp-1 italic">"{b.textSnippet}"</p>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Chapters Section */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[400px]">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-bold flex items-center gap-2 text-slate-800">
                    <BookIcon /> Table of Contents
                  </h3>
                </div>
                <div className="overflow-y-auto flex-grow p-2 space-y-1 scrollbar-hide">
                  {book.chapters.map((c, i) => (
                    <button 
                      key={c.id} 
                      onClick={() => {
                        if (i === currentChapterIndex && audioBufferRef.current) {
                          togglePlay();
                        } else {
                          pauseAudio();
                          setCurrentChapterIndex(i);
                          loadChapterAudio(i);
                        }
                      }}
                      className={`w-full text-left p-4 rounded-xl transition flex items-center justify-between group ${i === currentChapterIndex ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'hover:bg-slate-50 text-slate-700'}`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${i === currentChapterIndex ? 'bg-white/20' : 'bg-slate-100 text-slate-400'}`}>
                          {i + 1}
                        </span>
                        <span className="font-bold text-sm truncate pr-2">{c.title}</span>
                      </div>
                      {i === currentChapterIndex && isPlaying && (
                        <div className="flex gap-0.5 items-end h-3 shrink-0">
                          <div className="w-1 bg-white animate-[bounce_1s_infinite]" style={{ height: '100%' }}></div>
                          <div className="w-1 bg-white animate-[bounce_1s_infinite_0.1s]" style={{ height: '60%' }}></div>
                          <div className="w-1 bg-white animate-[bounce_1s_infinite_0.2s]" style={{ height: '80%' }}></div>
                        </div>
                      )}
                      {i === currentChapterIndex && !isPlaying && (
                        <div className="opacity-60 shrink-0"><PlayIcon /></div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {statusMessage && (
            <div className="bg-white border border-indigo-100 text-indigo-700 px-4 py-4 rounded-2xl text-sm shadow-sm flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
              {statusMessage}
            </div>
          )}
        </div>
      </main>

      <footer className="mt-12 text-center text-slate-400 text-xs pb-12 uppercase tracking-widest font-bold">
        Narrated by Gemini 2.5 Flash &bull; Analyzed by Gemini 3 Flash &bull; AuraReader 2.0
      </footer>
    </div>
  );
};

export default App;
