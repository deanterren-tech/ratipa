const fs = require('fs');
let code = fs.readFileSync('src/components/modules/UserManagementBlock.tsx', 'utf8');

// Replace handleUserPermChange
code = code.replace(
  /const handleUserPermChange = \(u: UserProfile, permKey: string, val: string\) => \{[\s\S]*?dbService\.saveUser\(\{ \.\.\.u, customPermissions: newCustom as any, permissions: newEffective as any \}\);\n  \};/,
  `const handleUserPermChange = (u: UserProfile, permKey: string, val: string) => {
    const newCustom = { ...(u.customPermissions || {}), [permKey]: val };
    const newEffective = computeEffectivePermissions(u.role, newCustom);
    
    // Optimistic UI update
    setUsers(prev => prev.map(user => 
      user.uid === u.uid 
        ? { ...user, customPermissions: newCustom as any, permissions: newEffective as any } 
        : user
    ));
    
    dbService.saveUser({ ...u, customPermissions: newCustom as any, permissions: newEffective as any });
  };`
);

// Replace handleRolePermChange
code = code.replace(
  /const handleRolePermChange = \(roleKey: string, permKey: string, val: string\) => \{[\s\S]*?toast\(\`Права роли обновлены\`, "success"\);\n  \};/,
  `const handleRolePermChange = (roleKey: string, permKey: string, val: string) => {
    const newRolePermissions = { 
      ...(settings?.rolePermissions || DEFAULT_ROLE_PERMS), 
      [roleKey]: { 
        ...(settings?.rolePermissions?.[roleKey] || DEFAULT_ROLE_PERMS[roleKey] || {}), 
        [permKey]: val 
      } 
    };
    
    // Optimistic Settings update
    if (settings) {
      setSettings({ ...settings, rolePermissions: newRolePermissions });
    }
    
    dbService.saveSettings({ ...settings, rolePermissions: newRolePermissions } as any);
    
    // Optimistic Users update
    setUsers(prev => prev.map(u => {
      if (u.role === roleKey) {
        const newEffective = computeEffectivePermissions(roleKey, u.customPermissions || {}, newRolePermissions);
        dbService.saveUser({ ...u, permissions: newEffective as any }); // Save to DB async
        return { ...u, permissions: newEffective as any };
      }
      return u;
    }));
    
    toast(\`Права роли обновлены\`, "success");
  };`
);

fs.writeFileSync('src/components/modules/UserManagementBlock.tsx', code);
