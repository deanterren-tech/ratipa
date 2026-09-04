import { useState, useEffect, useRef } from 'react'
import { dbService } from '../api'
import { UserProfile } from '../types'

export function usePresence(user: UserProfile, activeModule: string) {
  const [isDbOnline, setIsDbOnline] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const prevOnlineUsersRef = useRef<string>('');
  const onlineUsersTimeoutRef = useRef<any>(null);

  // Presence & Heartbeat ticker
  useEffect(() => {
    const cleanup = dbService.trackPresence(user, activeModule);
    setIsDbOnline(dbService.isOnline());

    const unsubscribeOnline = dbService.getOnlineUsers((users) => {
      // Keep users that were active recently (e.g. within 5 mins)
      const now = new Date().getTime();
      const activeUsers = users.filter((u: any) => {
         const t = new Date(u.lastActive).getTime();
         return (now - t) < 5 * 60 * 1000;
      });
      // Стабилизация: не обновляем, если список не изменился
      const key = activeUsers.map((u: any) => u.uid + ':' + u.currentModule + ':' + u.lastActive).join('|');
      if (key !== prevOnlineUsersRef.current) {
        prevOnlineUsersRef.current = key;
        // Debounce: отложенное обновление, чтобы сгладить каскад onValue
        if (onlineUsersTimeoutRef.current) clearTimeout(onlineUsersTimeoutRef.current);
        onlineUsersTimeoutRef.current = setTimeout(() => {
          setOnlineUsers(activeUsers);
        }, 2000);
      }
    });

    return () => {
      cleanup();
      if (typeof unsubscribeOnline === 'function') {
         unsubscribeOnline();
      }
      if (onlineUsersTimeoutRef.current) clearTimeout(onlineUsersTimeoutRef.current);
    };
  }, [activeModule, user]);

  return {
    isDbOnline,
    onlineUsers,
  };
}