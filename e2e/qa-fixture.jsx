// Development-only test entry. Not referenced by index.html or included in the production build.
// No production endpoint/credentials: data and roles exist only in this browser's memory.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { AomsEngine, INITIAL_AOMS_STATE } from '../src/domain/aomsEngine';
import { localTodayISO } from '../src/domain/models';
import { AomsProvider } from '../src/context/AomsContext';
import { makeTheme } from '../src/theme';
import AppShell from '../src/components/AppShell';
import EntityPage from '../src/pages/EntityPage';
import AomsDashboard from '../src/pages/AomsDashboard';
import '../src/styles.css';
import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/700.css';

const params = new URLSearchParams(location.search);
const roles = ['admin', 'operator', 'viewer'];
const profiles = roles.map((role, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, full_name: `QA ${role}`, role, status: 'active' }));
const engine = new AomsEngine({ ...INITIAL_AOMS_STATE(), profiles }, profiles[0]);
const today = localTodayISO();
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const category = await engine.saveCategory({ name: 'مضخات QA', code_prefix: 'QAP', uses_meter: true, meter_unit: 'ساعة تشغيل', supports_fuel: true, default_fuel_rate: 12, supports_chlorine: true, chlorine_unit: 'كجم', asset_kind: 'pump' });
const fuel = await engine.saveFuelType({ name: 'وقود QA', unit: 'لتر' });
const field = await engine.saveCategoryField({ category_id: category.id, scope: 'asset', field_key: 'qa_text', label: 'وصف QA', field_type: 'text', show_in_reports: true, is_active: true });
const asset = await engine.createAsset({ category_id: category.id, name: 'مضخة QA', pump_capacity: 10, fuel_type_id: fuel.id }, { [field.id]: 'QA-DYNAMIC-TOKEN' });
const operator = await engine.saveOperator({ name: 'مشغل QA', phone: '0591234567' });
await engine.saveFuelTransaction({ asset_id: asset.id, fuel_type_id: fuel.id, transaction_type: 'supply', transaction_date: yesterday, quantity: 1000, invoice_number: 'QA-FUEL-01' });
await engine.saveChlorineTransaction({ asset_id: asset.id, transaction_type: 'receipt', transaction_date: yesterday, quantity: 500 });
await engine.saveOperationLog({ asset_id: asset.id, operator_id: operator.id, operation_date: yesterday, previous_reading: 100, current_reading: 101, chlorine_consumed: 2 });
engine.state.audit_logs.push({ id: '00000000-0000-4000-8000-000000000099', entity_id: asset.id, entity_type: 'fuel_transaction', user_id: profiles[0].id, action: 'update', created_at: new Date(Date.now() + 1000).toISOString(), before_json: { notes: 'QA'.repeat(180), quantity: 10 }, after_json: { notes: 'QA'.repeat(180), quantity: 12 } });
engine.state.timeline_events.push({ id: '00000000-0000-4000-8000-000000000098', asset_id: asset.id, title: 'QA أحدث حدث', created_at: new Date(Date.now() + 1000).toISOString() });
const role = roles.includes(params.get('role')) ? params.get('role') : 'admin';
const profile = profiles.find(p => p.role === role);
engine.setUser(profile);

function Fixture() {
  const [mode, setMode] = useState('light');
  return <ThemeProvider theme={makeTheme(mode)}><CssBaseline /><AomsProvider customRepo={engine} initialProfile={profile}>
    <MemoryRouter initialEntries={[params.get('page') || '/']}>
      <Routes><Route element={<AppShell mode={mode} setMode={setMode} />}>
        <Route index element={<AomsDashboard />} />
        {['categories', 'assets', 'operators', 'operation_logs', 'fuel_transactions', 'chlorine_transactions', 'reports', 'search', 'timeline_events', 'settings', 'users', 'backup'].map(type => <Route key={type} path={type} element={<EntityPage key={type} type={type} />} />)}
      </Route></Routes>
    </MemoryRouter>
  </AomsProvider></ThemeProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
