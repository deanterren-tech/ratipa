import { useState, useEffect, useRef } from 'react'
import { dbService } from '../api'
import { UserProfile, ChatMessage } from '../types'

export function useChat(user: UserProfile) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastOpenedTime, setLastOpenedTime] = useState<number>(() => {
    return Number(localStorage.getItem('chat_last_opened_time') || Date.now());
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // States for user colors and message editing
  const [usersForColors, setUsersForColors] = useState<UserProfile[]>([]);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Subscribe to all users to map message colors in real time
  useEffect(() => {
    const unsub = dbService.getUsers((users) => {
      setUsersForColors(users);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const handleUpdateMessage = (id: string) => {
    const text = editingText.trim();
    if (!text) return;
    dbService.updateChatMessage(id, text);
    setEditingMsgId(null);
    setEditingText('');
  };

  // Subscribe to global dispatcher chat
  useEffect(() => {
    const unsubscribeChat = dbService.getChatMessages('global_panel_chat', (msgs) => {
      const sorted = [...msgs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      setChatMessages(sorted);
    });

    return () => {
      if (typeof unsubscribeChat === 'function') {
         unsubscribeChat();
      }
    };
  }, []);

  // Track unread messages
  useEffect(() => {
    if (isChatOpen) {
      const now = Date.now();
      setLastOpenedTime(now);
      localStorage.setItem('chat_last_opened_time', String(now));
      setUnreadCount(0);
    } else {
      const unread = chatMessages.filter(m => m.timestamp > lastOpenedTime && m.userId !== user.uid).length;
      setUnreadCount(unread);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages, isChatOpen, user.uid]);

  // Scroll to bottom
  useEffect(() => {
    if (isChatOpen) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [chatMessages, isChatOpen]);

  const handleSendGlobalMessage = () => {
    const text = chatInput.trim();
    if (!text) return;

    dbService.sendChatMessage('global_panel_chat', text, user.name, user.uid);
    setChatInput('');
  };

  const handleDeleteGlobalMessage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dbService.deleteChatMessage(id);
  };

  return {
    chatMessages,
    isChatOpen,
    setIsChatOpen,
    chatInput,
    setChatInput,
    unreadCount,
    messagesEndRef,
    usersForColors,
    editingMsgId,
    setEditingMsgId,
    editingText,
    setEditingText,
    handleSendGlobalMessage,
    handleDeleteGlobalMessage,
    handleUpdateMessage,
  };
}