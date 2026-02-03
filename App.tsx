
import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  SafeAreaView, 
  TouchableOpacity, 
  ActivityIndicator,
  Platform,
  Dimensions
} from 'react-native';
import { processPDF, generateSpeech, decodeAudioData } from './services/geminiService';
import { Book, Bookmark } from './types';
import { Button } from './components/Button';

const STORAGE_KEY = "aura_reader_current_book";
const { width } = Dimensions.get('window');

// Icons as basic SVG functional components for RN
const BookIcon = ({ color = "currentColor" }) => (
  <View style={{ width: 24, height: 24 }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
    </svg>
  </View>
);

const PlayIcon = ({ color = "white" }) => (
  <View style={{ width: 24, height: 24 }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill={color}>
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  </View>
);

const PauseIcon = ({ color = "white" }) => (
  <View style={{ width: 24, height: 24 }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill={color}>
      <rect x="6" y="4" width="4" height="16"></rect>
      <rect x="14" y="4" width="4" height="16"></rect>
    </svg>
  </View>
);

const BookmarkIcon = ({ color = "#4f46e5" }) => (
  <View style={{ width: 20, height: 20 }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
    </svg>
  </View>
);

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsedBook = JSON.parse(saved) as Book;
        setBook(parsedBook);
        setCurrentChapterIndex(parsedBook.lastPlayedChapter || 0);
        pausedAtRef.current = parsedBook.lastPlayedTime || 0;
        setCurrentTime(parsedBook.lastPlayedTime || 0);
        setStatusMessage("Restored your session");
        setTimeout(() => setStatusMessage(""), 3000);
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

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
  };

  const handleUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setStatusMessage("Gemini is reading...");
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
      } catch (err) {
        setStatusMessage("Analysis failed");
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const loadAudio = async (idx: number, seek: number = 0) => {
    if (!book) return;
    initAudio();
    setIsLoadingAudio(true);
    try {
      const pcm = await generateSpeech(book.chapters[idx].content);
      const buffer = await decodeAudioData(pcm, audioContextRef.current!);
      audioBufferRef.current = buffer;
      setDuration(buffer.duration);
      pausedAtRef.current = seek;
      setCurrentTime(seek);
      setStatusMessage("");
    } catch (err) {
      setStatusMessage("Narration failed");
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      sourceNodeRef.current?.stop();
      pausedAtRef.current = audioContextRef.current!.currentTime - startTimeRef.current;
      setIsPlaying(false);
    } else {
      if (!audioBufferRef.current) {
        loadAudio(currentChapterIndex, pausedAtRef.current).then(() => {
          const source = audioContextRef.current!.createBufferSource();
          source.buffer = audioBufferRef.current!;
          source.connect(audioContextRef.current!.destination);
          source.start(0, pausedAtRef.current);
          startTimeRef.current = audioContextRef.current!.currentTime - pausedAtRef.current;
          sourceNodeRef.current = source;
          setIsPlaying(true);
        });
      } else {
        const source = audioContextRef.current!.createBufferSource();
        source.buffer = audioBufferRef.current!;
        source.connect(audioContextRef.current!.destination);
        source.start(0, pausedAtRef.current);
        startTimeRef.current = audioContextRef.current!.currentTime - pausedAtRef.current;
        sourceNodeRef.current = source;
        setIsPlaying(true);
      }
    }
  };

  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        const now = audioContextRef.current!.currentTime - startTimeRef.current;
        setCurrentTime(Math.min(now, duration));
        if (now >= duration && duration > 0) setIsPlaying(false);
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
    <SafeAreaView style={styles.container}>
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept="application/pdf" 
        onChange={handleUpload} 
      />
      
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconContainer}><BookIcon color="#fff" /></View>
          <Text style={styles.headerTitle}>AuraReader</Text>
        </View>
        <Button 
          variant="outline" 
          size="sm" 
          onPress={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          {book ? "Change Book" : "Upload PDF"}
        </Button>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {isProcessing ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text style={styles.processingText}>{statusMessage}</Text>
          </View>
        ) : !book ? (
          <View style={styles.heroBox}>
            <View style={styles.heroIcon}><BookIcon color="#4f46e5" /></View>
            <Text style={styles.heroTitle}>Your library is empty</Text>
            <Text style={styles.heroSub}>Upload a PDF and let Gemini transform it into an immersive audiobook experience.</Text>
            <Button size="lg" onPress={() => fileInputRef.current?.click()}>Pick a PDF</Button>
          </View>
        ) : (
          <>
            <View style={styles.playerCard}>
              <View style={styles.bookInfo}>
                <View style={styles.coverPlaceholder} />
                <View style={styles.bookDetails}>
                  <Text style={styles.bookTitle} numberOfLines={2}>{book.title}</Text>
                  <Text style={styles.bookAuthor}>{book.author}</Text>
                </View>
              </View>

              <View style={styles.progressBar}>
                <View style={styles.track}>
                  <View style={[styles.progress, { width: `${(currentTime/duration)*100 || 0}%` }]} />
                </View>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                  <Text style={styles.timeText}>{formatTime(duration)}</Text>
                </View>
              </View>

              <View style={styles.controls}>
                <Button 
                  onPress={togglePlay} 
                  isLoading={isLoadingAudio}
                  style={styles.playButton}
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </Button>
                <TouchableOpacity style={styles.bookmarkAction} onPress={() => {
                  if (!book) return;
                  const b: Bookmark = {
                    id: Date.now().toString(),
                    title: `Point at ${formatTime(currentTime)}`,
                    chapterIndex: currentChapterIndex,
                    timestamp: currentTime,
                    textSnippet: book.chapters[currentChapterIndex].content.substring(0, 50),
                    createdAt: Date.now()
                  };
                  setBook({ ...book, bookmarks: [b, ...book.bookmarks] });
                }}>
                  <BookmarkIcon />
                  <Text style={styles.bookmarkText}>Save Bookmark</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Bookmarks</Text>
            </View>
            {book.bookmarks.length === 0 ? (
              <Text style={styles.emptyText}>No bookmarks yet.</Text>
            ) : (
              book.bookmarks.map(b => (
                <TouchableOpacity 
                  key={b.id} 
                  style={styles.bookmarkItem}
                  onPress={async () => {
                    if (b.chapterIndex !== currentChapterIndex) {
                      setCurrentChapterIndex(b.chapterIndex);
                      await loadAudio(b.chapterIndex, b.timestamp);
                    } else {
                      pausedAtRef.current = b.timestamp;
                      setCurrentTime(b.timestamp);
                    }
                  }}
                >
                  <View>
                    <Text style={styles.bookmarkLabel}>{b.title}</Text>
                    <Text style={styles.bookmarkSnippet}>Ch. {b.chapterIndex + 1} - "{b.textSnippet}..."</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Chapters</Text>
            </View>
            {book.chapters.map((c, i) => (
              <TouchableOpacity 
                key={c.id} 
                style={[styles.chapterItem, i === currentChapterIndex && styles.activeChapter]}
                onPress={() => {
                  setCurrentChapterIndex(i);
                  loadAudio(i);
                }}
              >
                <Text style={[styles.chapterText, i === currentChapterIndex && styles.activeChapterText]}>
                  {i + 1}. {c.title}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {statusMessage !== "" && !isProcessing && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{statusMessage}</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 20, 
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  iconContainer: { backgroundColor: '#4f46e5', padding: 6, borderRadius: 8, marginRight: 10 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  content: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  heroBox: { 
    backgroundColor: '#fff', 
    borderRadius: 20, 
    padding: 40, 
    alignItems: 'center', 
    marginTop: 40,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed'
  },
  heroIcon: { backgroundColor: '#f5f3ff', padding: 24, borderRadius: 100, marginBottom: 20 },
  heroTitle: { fontSize: 22, fontWeight: '700', marginBottom: 10, color: '#1e293b' },
  heroSub: { textAlign: 'center', color: '#64748b', lineHeight: 22, marginBottom: 30 },
  centerBox: { padding: 100, alignItems: 'center' },
  processingText: { marginTop: 20, color: '#4f46e5', fontWeight: '600' },
  playerCard: { 
    backgroundColor: '#fff', 
    borderRadius: 24, 
    padding: 20, 
    marginBottom: 30,
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#f1f5f9'
  },
  bookInfo: { flexDirection: 'row', marginBottom: 24 },
  coverPlaceholder: { 
    width: 80, 
    height: 110, 
    backgroundColor: '#4f46e5', 
    borderRadius: 12, 
    marginRight: 16 
  },
  bookDetails: { flex: 1, justifyContent: 'center' },
  bookTitle: { fontSize: 20, fontWeight: '800', color: '#1e293b', marginBottom: 4 },
  bookAuthor: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },
  progressBar: { marginBottom: 20 },
  track: { height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' },
  progress: { height: '100%', backgroundColor: '#4f46e5' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  timeText: { fontSize: 11, color: '#94a3b8', fontWeight: '600', fontFamily: 'monospace' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playButton: { width: 64, height: 64, borderRadius: 32 },
  bookmarkAction: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f3ff', padding: 10, borderRadius: 12 },
  bookmarkText: { marginLeft: 8, fontSize: 13, fontWeight: '700', color: '#4f46e5' },
  sectionHeader: { marginTop: 10, marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  bookmarkItem: { 
    backgroundColor: '#fff', 
    padding: 16, 
    borderRadius: 16, 
    marginBottom: 10, 
    borderWidth: 1, 
    borderColor: '#f1f5f9' 
  },
  bookmarkLabel: { fontWeight: '700', fontSize: 14, color: '#334155', marginBottom: 4 },
  bookmarkSnippet: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },
  chapterItem: { 
    backgroundColor: '#fff', 
    padding: 14, 
    borderRadius: 12, 
    marginBottom: 6, 
    borderWidth: 1, 
    borderColor: '#f1f5f9' 
  },
  chapterText: { fontWeight: '600', fontSize: 14, color: '#475569' },
  activeChapter: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  activeChapterText: { color: '#fff' },
  emptyText: { color: '#94a3b8', fontSize: 14, fontStyle: 'italic', paddingVertical: 10 },
  toast: { 
    position: 'absolute', 
    bottom: 20, 
    left: 20, 
    right: 20, 
    backgroundColor: '#1e293b', 
    padding: 16, 
    borderRadius: 16,
    alignItems: 'center'
  },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600' }
});

export default App;
