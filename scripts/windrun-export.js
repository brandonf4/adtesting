// Windrun export for the AD Simulator testing site.
// Run this in the browser console while on https://windrun.io (F12 → Console → paste → Enter).
// It only READS public windrun data (the same requests the windrun site makes itself)
// and downloads it as one file, windrun-export.json. Upload that file to the project.
(async () => {
  const API = 'https://api.windrun.io/api/v2';
  const get = async (path) => {
    const r = await fetch(API + path, { credentials: 'include' });
    if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
    return r.json();
  };
  const historic = await get('/heroes/historic');
  const patches = [...new Set(historic?.data?.patches ?? [])];
  const patch = patches[patches.length - 1];
  if (!patch) throw new Error('Could not find the latest patch');
  const q = '?patch=' + encodeURIComponent(patch);
  console.log('Exporting windrun data for patch', patch, '...');
  const out = { exportedAt: new Date().toISOString(), patch, patches };
  const parts = {
    staticHeroes: '/static/heroes',
    staticAbilities: '/static/abilities',
    abilities: '/abilities' + q,
    abilityHighSkill: '/ability-high-skill' + q,
    abilityPairs: '/ability-pairs' + q,
    heroes: '/heroes' + q,
  };
  for (const [key, path] of Object.entries(parts)) {
    out[key] = await get(path);
    console.log('  got', key);
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'windrun-export.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('Done: windrun-export.json downloaded for patch', patch);
})().catch((e) => console.error('Windrun export failed:', e));
