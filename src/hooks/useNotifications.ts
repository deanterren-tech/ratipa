import { useState, useEffect, useMemo, useRef } from 'react'
import { ref, update } from 'firebase/database'
import { dbService, database, useFirebase, onValue } from '../api'
import { UserProfile, AppSettings } from '../types'

export interface NotificationItem {
  id: string;
  title: string;
  text: string;
  type: 'info' | 'warning' | 'success' | 'alert';
  date: string;
  isRead: boolean;
  dispatcher?: string;
  isDeleted?: boolean;
  targetRoles?: string[];
}

export function useNotifications(user: UserProfile, settings: AppSettings | null) {
  const [broadcastNotifications, setBroadcastNotifications] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [userNotifState, setUserNotifState] = useState<Record<string, {isRead: boolean, isDeleted: boolean}>>({});
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifTab, setNotifTab] = useState<'all' | 'unread'>('all');
  const notifRef = useRef<HTMLDivElement>(null);

  // Real-time Database references for notification auto-generation
  const [bazaCars, setBazaCars] = useState<any[]>([]);
  const [tripsDashboard, setTripsDashboard] = useState<any[]>([]);

  // Subscribe to broadcast notifications
  useEffect(() => {
    return dbService.getBroadcastNotifications(setBroadcastNotifications);
  }, []);

  const activeUnreadBroadcasts = useMemo(() => {
    if (!user) return [];
    return broadcastNotifications.filter(notif => {
      const readBy = notif.readBy || {};
      return !readBy[user.uid];
    });
  }, [broadcastNotifications, user]);

  // Sync notifications from Firebase Realtime Database
  useEffect(() => {
    if (!useFirebase || !user) return;
    try {
      const notifRef = ref(database, 'ratipa_notifications');
      const unsubNotif = onValue(notifRef, snap => {
        const val = snap.val();
        if (val) {
          const list: NotificationItem[] = Object.keys(val).map(key => ({
            id: key,
            ...val[key]
          }));

          list.sort((a, b) => {
            const tA = a.id.startsWith('notif_') ? parseInt(a.id.replace('notif_', '')) : (a.id.includes('_') ? parseInt(a.id.split('_').slice(-1)[0]) || 0 : 0);
            const tB = b.id.startsWith('notif_') ? parseInt(b.id.replace('notif_', '')) : (b.id.includes('_') ? parseInt(b.id.split('_').slice(-1)[0]) || 0 : 0);
            if (tA && tB) return tB - tA;
            const dateA = a.date || '';
            const dateB = b.date || '';
            return dateB.localeCompare(dateA);
          });

          setNotifications(list);
        } else {
          setNotifications([]);
        }
      });

      const userNotifRef = ref(database, `users/${user.uid}/notificationStates`);
      const unsubUserNotif = onValue(userNotifRef, snap => {
        setUserNotifState(snap.val() || {});
      });

      return () => {
        unsubNotif();
        unsubUserNotif();
      }
    } catch (e) {
      console.warn("Error subscribing to ratipa_notifications in Firebase", e);
    }
  }, [user]);

  // Subscribe to baza_cars and trips_dashboard for notification auto-generation
  useEffect(() => {
    if (!useFirebase) return;
    try {
      const unsubBaza = dbService.getVehicleFleet((list) => setBazaCars(list || []));
      const unsubTrips = onValue(ref(database, 'trips_dashboard'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setTripsDashboard(list);
      });
      return () => {
        unsubBaza();
        unsubTrips();
      };
    } catch (e) {
      console.warn("Error subscribing in useNotifications:", e);
    }
  }, []);

  const markNotifAsRead = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (useFirebase && user) {
      try {
        const currentReadState = userNotifState[id]?.isRead || false;
        update(ref(database, `users/${user.uid}/notificationStates/${id}`), { isRead: !currentReadState }).catch((err) => console.warn("Failed to mark read in firebase", err));
      } catch (err) {
        console.warn("Failed to mark read in firebase", err);
      }
    }
  };

  const markAllNotifsAsRead = () => {
    if (useFirebase && user) {
      try {
        const updates: Record<string, any> = {};
        notifications.forEach(n => {
          if (!userNotifState[n.id]?.isRead && !userNotifState[n.id]?.isDeleted) {
            updates[`users/${user.uid}/notificationStates/${n.id}/isRead`] = true;
          }
        });
        if (Object.keys(updates).length > 0) {
          update(ref(database), updates).catch((err) => console.warn("Failed to update notifications in firebase", err));
        }
      } catch (err) {
        console.warn("Failed to mark all read in firebase", err);
      }
    }
  };

  const deleteNotif = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (useFirebase && user) {
      try {
        update(ref(database, `users/${user.uid}/notificationStates/${id}`), { isDeleted: true }).catch((err) => console.warn("Failed to mark deleted in firebase", err));
      } catch (err) {
        console.warn("Failed to mark deleted in firebase", err);
      }
    }
  };

  const clearAllNotifications = () => {
    if (useFirebase && user) {
      try {
        const updates: Record<string, any> = {};
        notifications.forEach(n => {
          updates[`users/${user.uid}/notificationStates/${n.id}/isDeleted`] = true;
        });
        if (Object.keys(updates).length > 0) {
          update(ref(database), updates).catch((err) => console.warn("Failed to update notifications in firebase", err));
        }
      } catch (err) {
        console.warn("Failed to clear notifications in firebase", err);
      }
    }
  };

  // Фильтрованные уведомления с учётом роли и настроек
  const filteredNotifications = useMemo(() => {
    if (!user) return [];

    if (settings?.notificationAccess) {
      const enabledRoles = settings.notificationAccess.enabledRoles || [];
      if (enabledRoles.length > 0 && !enabledRoles.includes(user.role)) {
        return [];
      }
    }

    const visible = notifications.filter(n => {
      if (userNotifState[n.id]?.isDeleted) return false;

      if (n.targetRoles && n.targetRoles.length > 0) {
        if (!n.targetRoles.includes(user.role)) return false;
      }

      if (settings?.notificationAccess?.roleNotificationTypes) {
        const allowedTypes = settings.notificationAccess.roleNotificationTypes[user.role];
        if (allowedTypes && n.type && !allowedTypes.includes(n.type)) {
          return false;
        }
      }

      return true;
    });

    if (notifTab === 'unread') {
      return visible.filter(n => !userNotifState[n.id]?.isRead);
    }
    return visible;
  }, [notifications, notifTab, userNotifState, user, settings]);

  const unreadNotifsCount = useMemo(() => {
    return filteredNotifications.filter(n => !userNotifState[n.id]?.isRead).length;
  }, [filteredNotifications, userNotifState]);

  return {
    notifications,
    filteredNotifications,
    unreadNotifsCount,
    isNotifOpen,
    setIsNotifOpen,
    notifTab,
    setNotifTab,
    notifRef,
    activeUnreadBroadcasts,
    markNotifAsRead,
    markAllNotifsAsRead,
    deleteNotif,
    clearAllNotifications,
    // Internal state (exposed for click-outside handling in AppShell)
    bazaCars,
    tripsDashboard,
  };
}