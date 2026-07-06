const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

const promptFunc = `
  const checkManualDistanceUpdate = (from: string, to: string, newDist: number) => {
    if (!from || !to || newDist <= 0) return;
    const matched = distances.find((d) => {
      const a = (d.from || "").trim().toLowerCase();
      const b = (d.to || "").trim().toLowerCase();
      return (
        (a === from.trim().toLowerCase() && b === to.trim().toLowerCase()) ||
        (a === to.trim().toLowerCase() && b === from.trim().toLowerCase())
      );
    });

    if (!matched || matched.distance !== newDist) {
      const q = matched
        ? \`Изменить расстояние \${from} - \${to} в базе шаблонов с \${matched.distance} км на \${newDist} км?\`
        : \`Сохранить новое плечо \${from} - \${to} (\${newDist} км) в общую базу шаблонов расстояний?\`;

      setTimeout(async () => {
        if (await showConfirm(q)) {
          if (matched) {
            dbService.saveDistance(
              { ...matched, distance: newDist },
              user.name,
              user.role,
            );
          } else {
            dbService.saveDistance(
              { id: "dist_" + Date.now(), from, to, distance: newDist },
              user.name,
              user.role,
            );
          }
        }
      }, 500);
    }
  };
`;

const checkLegDistanceTarget = `  const checkLegDistance = (idx: number, isPotentialList: boolean = false) => {`;

if (code.includes(checkLegDistanceTarget)) {
  code = code.replace(checkLegDistanceTarget, promptFunc + '\n' + checkLegDistanceTarget);
  fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);
  console.log("Added checkManualDistanceUpdate to PlanDohod");
} else {
  console.log("checkLegDistanceTarget not found");
}

