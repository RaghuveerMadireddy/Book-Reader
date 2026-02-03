
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { processPDF, generateSpeech, decodeAudioData } from './services/geminiService';
import { Book, Bookmark, Chapter } from './types';
import { Button } from './components/Button';

// Icons
const PlayIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>;
const PauseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>;
const BookmarkIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>;
const BookIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>;

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

  const loadChapterAudio = async (index: number) => {
    if (!book || !book.chapters[index]) return;
    
    initAudioContext();
    setIsLoadingAudio(true);
    setStatusMessage(`Generating narration for: ${book.chapters[index].title}...`);
    
    try {
      const pcmData = await generateSpeech(book.chapters[index].content);
      const buffer = await decodeAudioData(pcmData, audioContextRef.current!);
      audioBufferRef.current = buffer;
      setDuration(buffer.duration);
      setCurrentTime(0);
      pausedAtRef.current = 0;
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
    
    const offset = pausedAtRef.current;
    source.start(0, offset);
    startTimeRef.current = audioContextRef.current.currentTime - offset;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    source.onended = () => {
      // Logic for automatic chapter transition could go here
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
        loadChapterAudio(currentChapterIndex).then(() => playAudio());
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
      title: `Bookmark @ ${formatTime(currentTime)}`,
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
      await loadChapterAudio(bookmark.chapterIndex);
    }
    pausedAtRef.current = bookmark.timestamp;
    setCurrentTime(bookmark.timestamp);
    playAudio();
  };

  // Sync current time UI
  useEffect(() => {
    let interval: any;
    if (isPlaying && audioContextRef.current) {
      interval = setInterval(() => {
        const now = audioContextRef.current!.currentTime - startTimeRef.current;
        setCurrentTime(Math.min(now, duration));
        if (now >= duration) {
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
          <h1 className="text-2xl font-bold text-slate-900">AuraReader</h1>
        </div>
        {!book && !isProcessing && (
          <label className="cursor-pointer bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition">
            Upload PDF
            <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
          </label>
        )}
      </header>

      <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-8 flex-grow">
        {/* Left: Book Content & Player */}
        <div className="lg:col-span-2 space-y-6">
          {!book && !isProcessing && (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl h-96 flex flex-col items-center justify-center text-center p-8">
              <div className="bg-slate-50 p-6 rounded-full mb-4">
                <BookIcon />
              </div>
              <h2 className="text-xl font-semibold mb-2">No book selected</h2>
              <p className="text-slate-500 max-w-sm mb-6">Upload a PDF to transform it into a narrated audiobook with smart bookmarks.</p>
              <Button size="lg" onClick={() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.click()}>
                Upload Your First Book
              </Button>
            </div>
          )}

          {isProcessing && (
            <div className="bg-white rounded-2xl p-12 border border-slate-200 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-6"></div>
              <h2 className="text-xl font-semibold mb-2">Analyzing your book...</h2>
              <p className="text-slate-500">{statusMessage}</p>
            </div>
          )}

          {book && (
            <>
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                <div className="flex flex-col md:flex-row gap-6 mb-8">
                  <div className="w-32 h-44 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-300">
                    <BookIcon />
                  </div>
                  <div className="flex-grow">
                    <h2 className="text-2xl font-bold text-slate-900 mb-1">{book.title}</h2>
                    <p className="text-slate-500 mb-4 font-medium">{book.author}</p>
                    
                    <div className="flex items-center gap-4 text-sm text-slate-500 mb-6">
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span> {book.chapters.length} Chapters</span>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> {book.bookmarks.length} Bookmarks</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-indigo-600 h-full transition-all duration-300" 
                          style={{ width: `${(currentTime / duration) * 100}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs font-mono text-slate-400">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-6">
                  <div className="flex items-center gap-4">
                    <Button 
                      variant="primary" 
                      size="lg" 
                      onClick={togglePlay} 
                      isLoading={isLoadingAudio}
                      className="w-14 h-14 rounded-full p-0 flex items-center justify-center shadow-lg shadow-indigo-200"
                    >
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </Button>
                    <div>
                      <h4 className="font-semibold text-slate-900 truncate max-w-[200px]">
                        {book.chapters[currentChapterIndex]?.title}
                      </h4>
                      <p className="text-xs text-slate-400">Currently Narrating</p>
                    </div>
                  </div>

                  <Button variant="outline" onClick={addBookmark} className="gap-2">
                    <BookmarkIcon /> Bookmark
                  </Button>
                </div>
              </div>

              {/* Chapter Content Preview */}
              <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold mb-4 flex items-center justify-between">
                  <span>Current Chapter Text</span>
                  <span className="text-xs font-normal text-slate-400">Previewing portion</span>
                </h3>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed italic">
                  "{book.chapters[currentChapterIndex]?.content.substring(0, 1000)}..."
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
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                  <h3 className="font-bold flex items-center gap-2">
                    <BookmarkIcon /> Bookmarks
                  </h3>
                </div>
                <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                  {book.bookmarks.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-400 italic">No bookmarks yet. Save one while listening!</p>
                  ) : (
                    book.bookmarks.map((b) => (
                      <button 
                        key={b.id} 
                        onClick={() => jumpToBookmark(b)}
                        className="w-full text-left p-3 rounded-xl hover:bg-indigo-50 transition group"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-slate-800 group-hover:text-indigo-700">{b.title}</span>
                          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full uppercase font-bold">Ch. {b.chapterIndex + 1}</span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">{b.textSnippet}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Chapters Section */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                  <h3 className="font-bold flex items-center gap-2">
                    <BookIcon /> Chapters
                  </h3>
                </div>
                <div className="max-h-96 overflow-y-auto p-2 space-y-1">
                  {book.chapters.map((c, i) => (
                    <button 
                      key={c.id} 
                      onClick={() => {
                        pauseAudio();
                        setCurrentChapterIndex(i);
                        loadChapterAudio(i);
                      }}
                      className={`w-full text-left p-3 rounded-xl transition flex items-center justify-between group ${i === currentChapterIndex ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 text-slate-700'}`}
                    >
                      <span className="font-medium truncate pr-2">{i + 1}. {c.title}</span>
                      {i === currentChapterIndex && isPlaying && <div className="flex gap-0.5 items-end h-3">
                        <div className="w-1 bg-white animate-pulse" style={{ height: '100%' }}></div>
                        <div className="w-1 bg-white animate-pulse" style={{ height: '60%', animationDelay: '0.2s' }}></div>
                        <div className="w-1 bg-white animate-pulse" style={{ height: '80%', animationDelay: '0.4s' }}></div>
                      </div>}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {statusMessage && (
            <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-3 rounded-xl text-sm animate-fade-in">
              {statusMessage}
            </div>
          )}
        </div>
      </main>

      <footer className="mt-12 text-center text-slate-400 text-sm pb-8">
        Powered by Gemini 3 Flash & 2.5 Flash TTS &bull; AuraReader 2024
      </footer>
    </div>
  );
};

export default App;
