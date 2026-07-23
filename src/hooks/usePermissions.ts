import { useMemo } from 'react';
import { UserProfile } from '../types';

export const usePermissions = (user: UserProfile | null) => {
  return useMemo(() => {
    const role = user?.role || 'viewer';
    
    // Core roles mapping
    const isRootAdmin = role === 'root_admin';
    const isAdmin = role === 'admin' || isRootAdmin;
    const isManager = role === 'manager';
    const isDispatcher = role === 'dispatcher';
    const isAccountant = role === 'accountant';
    
    // Hierarchical permissions
    const canManageUsers = isRootAdmin;
    const canEditSettings = isAdmin || isManager;
    const canDeleteRecords = isAdmin;
    const canAddCars = isAdmin || isManager || isDispatcher;
    const canEditBase = isAdmin || isManager;
    const canArchiveTrip = isAdmin || isManager || isDispatcher;
    const canAccessSalaries = isAdmin || isManager || isAccountant;
    const canResizeWidgets = isAdmin;

    return {
      isRootAdmin,
      isAdmin,
      isManager,
      isDispatcher,
      isAccountant,
      
      canManageUsers,
      canEditSettings,
      canDeleteRecords,
      canAddCars,
      canEditBase,
      canArchiveTrip,
      canAccessSalaries,
      canResizeWidgets,
    };
  }, [user]);
};
