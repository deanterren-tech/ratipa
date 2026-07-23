const fs = require('fs');
let code = fs.readFileSync('src/components/modules/BazaModule.tsx', 'utf8');

const anchor = " useState, useEffect, useMemo, useRef } from 'react';";
const firstIndex = code.indexOf(anchor);
const index = code.indexOf(anchor, firstIndex + 1);

if (index !== -1) {
  const originalFile = 'import React, {' + code.substring(index);
  fs.writeFileSync('src/components/modules/BazaModule.tsx', originalFile);
  console.log('Restored!');
} else {
  console.log('Not found');
}
