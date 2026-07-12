const fs = require('fs');
let code = fs.readFileSync('src/components/modules/BazaModule.tsx', 'utf8');

const anchor = " useState, useEffect, useMemo, useRef } from 'react';";
console.log("Delete references in original code?");
