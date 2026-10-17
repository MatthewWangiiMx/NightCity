import { Route, Routes } from 'react-router-dom';
import AppShell from '@/components/AppShell';
import CommandCenter from '@/pages/CommandCenter';
import WhatIfLab from '@/pages/WhatIfLab';
import DispatchReview from '@/pages/DispatchReview';
import BuildingDetail from '@/pages/BuildingDetail';
import Results from '@/pages/Results';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/what-if" element={<WhatIfLab />} />
        <Route path="/dispatch" element={<DispatchReview />} />
        <Route path="/building/:buildingId" element={<BuildingDetail />} />
        <Route path="/results" element={<Results />} />
      </Routes>
    </AppShell>
  );
}
