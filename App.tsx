
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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { 
  BookOpen, 
  Play, 
  Pause, 
  Bookmark as BookmarkIconLucide, 
  Trash2, 
  Upload, 
  ChevronRight,
  Clock,
  Volume2
} from 'lucide-react-native';
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

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
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
        audioBufferRef.current = null;
      } catch (err) {
        setStatusMessage("Analysis failed");
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
      setStatusMessage("");
      return buffer;
    } catch (err) {
      setStatusMessage("Narration failed");
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
      textSnippet: book.chapters[currentChapterIndex].content.substring(0, 60),
      createdAt: Date.now()
    };
    setBook({ ...book, bookmarks: [b, ...book.bookmarks] });
    setStatusMessage("Bookmark saved");
    setTimeout(() => setStatusMessage(""), 2000);
  };

  useEffect(() => {
    let interval: any;
    if (isPlaying && audioContextRef.current) {
      interval = setInterval(() => {
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
    <SafeAreaProvider style={styles.rootProvider}>
      <View style={styles.outerContainer}>
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
              <View style={styles.iconContainer}><BookOpen size={20} color="#fff" /></View>
              <Text style={styles.headerTitle}>AuraReader</Text>
            </View>
            <View style={styles.headerRight}>
              <Button 
                variant="outline" 
                size="sm" 
                onPress={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                <Upload size={14} style={{ marginRight: 6 }} color="#475569" />
                <Text>{book ? "Change" : "Upload"}</Text>
              </Button>
            </View>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {isProcessing ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color="#4f46e5" />
                <Text style={styles.processingText}>{statusMessage}</Text>
              </View>
            ) : !book ? (
              <View style={styles.heroBox}>
                <View style={styles.heroIcon}><BookOpen size={48} color="#4f46e5" /></View>
                <Text style={styles.heroTitle}>Welcome to AuraReader</Text>
                <Text style={styles.heroSub}>Upload any PDF book to turn it into an audiobook with smart bookmarks.</Text>
                <Button size="lg" onPress={() => fileInputRef.current?.click()}>Pick a PDF</Button>
              </View>
            ) : (
              <>
                <View style={styles.playerCard}>
                  <View style={styles.bookInfo}>
                    <View style={styles.coverPlaceholder}><BookOpen size={32} color="#fff" opacity={0.3} /></View>
                    <View style={styles.bookDetails}>
                      <Text style={styles.bookTitle} numberOfLines={2}>{book.title}</Text>
                      <Text style={styles.bookAuthor}>{book.author}</Text>
                    </View>
                  </View>
                  <View style={styles.progressBar}>
                    <View style={styles.track}><View style={[styles.progress, { width: `${(currentTime/duration)*100 || 0}%` }]} /></View>
                    <View style={styles.timeRow}>
                      <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                      <Text style={styles.timeText}>{formatTime(duration)}</Text>
                    </View>
                  </View>
                  <View style={styles.controls}>
                    <Button onPress={togglePlay} isLoading={isLoadingAudio} style={styles.playButton}>
                      {isPlaying ? <Pause size={28} color="white" fill="white" /> : <Play size={28} color="white" fill="white" />}
                    </Button>
                    <TouchableOpacity style={styles.bookmarkAction} onPress={addBookmark}>
                      <BookmarkIconLucide size={18} color="#4f46e5" />
                      <Text style={styles.bookmarkText}>Bookmark</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.sectionTitle}>Bookmarks</Text>
                {book.bookmarks.length === 0 ? <Text style={styles.emptyText}>No bookmarks yet.</Text> : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bookmarkScroll}>
                    {book.bookmarks.map(b => (
                      <TouchableOpacity key={b.id} style={styles.bookmarkCardItem} onPress={() => navigateToChapter(b.chapterIndex)}>
                        <Text style={styles.bookmarkLabel} numberOfLines={1}>{b.title}</Text>
                        <Text style={styles.bookmarkSnippet} numberOfLines={2}>{b.textSnippet}...</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                <Text style={styles.sectionTitle}>Chapters</Text>
                {book.chapters.map((c, i) => {
                  const isActive = i === currentChapterIndex;
                  return (
                    <TouchableOpacity key={c.id} style={[styles.chapterItem, isActive && styles.activeChapter]} onPress={() => navigateToChapter(i)}>
                      <Text style={[styles.chapterText, isActive && styles.activeText]}>{i + 1}. {c.title}</Text>
                      <ChevronRight size={18} color={isActive ? "#fff" : "#cbd5e1"} />
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </ScrollView>
          {statusMessage !== "" && !isProcessing && <View style={styles.toast}><Text style={styles.toastText}>{statusMessage}</Text></View>}
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  rootProvider: { flex: 1 },
  outerContainer: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconContainer: { backgroundColor: '#4f46e5', padding: 8, borderRadius: 10, marginRight: 12 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  content: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  heroBox: { backgroundColor: '#fff', borderRadius: 24, padding: 40, alignItems: 'center', marginTop: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  heroIcon: { backgroundColor: '#f5f3ff', padding: 24, borderRadius: 100, marginBottom: 24 },
  heroTitle: { fontSize: 24, fontWeight: '800', color: '#1e293b' },
  heroSub: { textAlign: 'center', color: '#64748b', marginBottom: 32 },
  playerCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, marginBottom: 24, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
  bookInfo: { flexDirection: 'row', marginBottom: 20 },
  coverPlaceholder: { width: 64, height: 84, backgroundColor: '#4f46e5', borderRadius: 12, marginRight: 16, alignItems: 'center', justifyContent: 'center' },
  bookDetails: { flex: 1, justifyContent: 'center' },
  bookTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  bookAuthor: { fontSize: 14, color: '#64748b' },
  progressBar: { marginBottom: 20 },
  track: { height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden' },
  progress: { height: '100%', backgroundColor: '#4f46e5' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  timeText: { fontSize: 11, color: '#94a3b8', fontWeight: '700' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playButton: { width: 64, height: 64, borderRadius: 32 },
  bookmarkAction: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f3ff', padding: 12, borderRadius: 12 },
  bookmarkText: { marginLeft: 8, fontSize: 14, fontWeight: '700', color: '#4f46e5' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b', marginTop: 16, marginBottom: 12 },
  bookmarkScroll: { marginBottom: 20 },
  bookmarkCardItem: { backgroundColor: '#fff', padding: 16, borderRadius: 16, marginRight: 12, width: 180, borderWidth: 1, borderColor: '#f1f5f9' },
  bookmarkLabel: { fontWeight: '800', fontSize: 13, color: '#334155' },
  bookmarkSnippet: { fontSize: 12, color: '#94a3b8' },
  chapterItem: { backgroundColor: '#fff', padding: 16, borderRadius: 16, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeChapter: { backgroundColor: '#4f46e5' },
  activeText: { color: '#fff' },
  chapterText: { fontWeight: '700', color: '#475569' },
  emptyText: { color: '#94a3b8', fontStyle: 'italic' },
  toast: { position: 'absolute', bottom: 32, left: 20, right: 20, backgroundColor: '#0f172a', padding: 16, borderRadius: 12, alignItems: 'center', zIndex: 100 },
  toastText: { color: '#fff', fontWeight: '700' },
  centerBox: { padding: 100, alignItems: 'center' },
  processingText: { marginTop: 16, color: '#4f46e5', fontWeight: '700' }
});

export default App;
