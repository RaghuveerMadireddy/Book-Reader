
export interface Bookmark {
  id: string;
  title: string;
  chapterIndex: number;
  timestamp: number;
  textSnippet: string;
  createdAt: number;
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  chapters: Chapter[];
  bookmarks: Bookmark[];
  lastPlayedChapter: number;
  lastPlayedTime: number;
}
