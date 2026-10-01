import { useState } from 'react';
import type { BundleEntry } from '@/bundles';
import { SelectPage } from './ui/SelectPage';
import { PlayPage } from './ui/PlayPage';

export function App() {
  const [selected, setSelected] = useState<BundleEntry | null>(null);
  if (!selected) return <SelectPage onSelect={setSelected} />;
  return <PlayPage bundle={selected.bundle} onBack={() => setSelected(null)} />;
}
