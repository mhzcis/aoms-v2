import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AssessmentRounded,
  BackupRounded,
  CategoryRounded,
  CloudDownloadRounded,
  DarkModeRounded,
  DashboardRounded,
  DeleteForeverRounded,
  HistoryRounded,
  LightModeRounded,
  LocalGasStationRounded,
  LogoutRounded,
  ManageAccountsRounded,
  MenuRounded,
  PeopleRounded,
  PrecisionManufacturingRounded,
  ScienceRounded,
  SearchRounded,
  SettingsRounded,
  TimelineRounded,
} from '@mui/icons-material';
import { useAoms } from '../context/AomsContext';
import { useApp } from '../context/AppContext';
import { canAdmin } from '../domain/models';
import { isFileSystemAccessSupported } from '../services/backupService';
import { WipeDialog } from './Common';

const width = 275;

const baseLinks = [
  ['/', 'لوحة التحكم', DashboardRounded, false],
  ['/categories', 'التصنيفات والحقول', CategoryRounded, false],
  ['/assets', 'الأصول والمعدات', PrecisionManufacturingRounded, false],
  ['/operators', 'المشغلون', PeopleRounded, false],
  ['/operation_logs', 'سجلات التشغيل', HistoryRounded, false],
  ['/fuel_transactions', 'الوقود والأرصدة', LocalGasStationRounded, false],
  ['/chlorine_transactions', 'الكلور والأرصدة', ScienceRounded, false],
  ['/reports', 'التقارير والتصدير', AssessmentRounded, false],
  ['/search', 'البحث العالمي', SearchRounded, false],
  ['/timeline_events', 'الخط الزمني والتدقيق', TimelineRounded, false],
  ['/settings', 'الإعدادات وأنواع الوقود', SettingsRounded, false],
  ['/users', 'المستخدمون والصلاحيات', ManageAccountsRounded, true],
  ['/backup', 'النسخ الاحتياطي والاستعادة', BackupRounded, true],
];

export default function AppShell({ mode = 'light', setMode }) {
  const mobile = useMediaQuery('(max-width:900px)');
  const [open, setOpen] = useState(false);
  const [wipe, setWipe] = useState(false);
  const aoms = useAoms();
  const app = useApp();

  const profile = aoms?.profile;
  const online = aoms ? aoms.online : true;
  const notice = aoms ? aoms.notice : app?.notice;
  const setNotice = aoms ? aoms.setNotice : app?.setNotice;
  const signOut = aoms?.signOut;
  const isAdmin = canAdmin(profile);

  const fileLinkSupported = app?.fileLinkSupported ?? isFileSystemAccessSupported();

  const visibleLinks = baseLinks.filter(([, , , adminOnly]) => !adminOnly || isAdmin);

  const menu = (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          p: 1.5,
          borderRadius: 3,
          bgcolor: theme => alpha(theme.palette.primary.main, 0.08),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" color="primary" sx={{ fontWeight: 800 }}>
          ⚙️ AOMS V2
        </Typography>
        <Chip
          size="small"
          color={online ? 'success' : 'warning'}
          label={online ? 'متصل' : 'قراءة فقط'}
        />
      </Box>

      <List sx={{ mt: 1, flexGrow: 1, overflowY: 'auto' }}>
        {visibleLinks.map(([to, t, IconComp]) => (
          <ListItemButton
            component={NavLink}
            to={to}
            end={to === '/'}
            key={to}
            onClick={() => setOpen(false)}
            sx={{
              mb: 0.5,
              borderRadius: 2.5,
              '&.active': {
                bgcolor: 'primary.main',
                color: '#fff',
                '& .MuiListItemIcon-root': { color: '#fff' },
              },
            }}
          >
            <ListItemIcon>
              <IconComp fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={t} />
          </ListItemButton>
        ))}
      </List>

      {app && (
        <>
      <Button
        fullWidth
        variant="outlined"
        startIcon={<CloudDownloadRounded />}
        onClick={app?.manualBackup}
        sx={{ mt: 1 }}
      >
        نسخة احتياطية
      </Button>
      <Button
        fullWidth
        color="error"
        variant="outlined"
        startIcon={<DeleteForeverRounded />}
        onClick={() => {
          setOpen(false);
          setWipe(true);
        }}
        sx={{ mt: 1 }}
      >
        مسح شامل
      </Button>
      {fileLinkSupported ? (
        <Button
          fullWidth
          variant="outlined"
          size="small"
          onClick={app?.linkBackup}
          sx={{ mt: 1 }}
        >
          ربط ملف نسخة احتياطية
        </Button>
      ) : (
        <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 1 }}>
          ربط ملف النسخة الاحتياطية غير مدعوم في هذا المتصفح
        </Typography>
      )}
        </>
      )}

      <Box sx={{ mt: 'auto', pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
        {aoms && (
          <>
            <Typography variant="body2" fontWeight={700}>
              {profile?.full_name || 'مستخدم'} ({profile?.role || 'viewer'})
            </Typography>
            <Button
              fullWidth
              size="small"
              startIcon={<LogoutRounded />}
              color="error"
              onClick={signOut}
              sx={{ mt: 0.5, justifyContent: 'flex-start' }}
            >
              تسجيل الخروج
            </Button>
          </>
        )}

        <Box
          sx={{
            mt: 1.25,
            p: 1.25,
            borderRadius: 2.5,
            textAlign: 'right',
            color: 'text.secondary',
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="caption" component="div">برمجة وتطوير:</Typography><Typography variant="caption" component="div" fontWeight={800} color="text.primary">م. محمد أبو زهري</Typography>
          <Box
            sx={{
              mt: 0.5,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
            }}
          >
            <span>صُنع بكل حب وإتقان</span>
            <span style={{ color: '#e11d48' }}>♥️</span>
          </Box>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          mr: mobile ? 0 : `${width}px`,
          width: mobile ? '100% - 0px' : `calc(100% - ${width}px)`,
          backdropFilter: 'blur(16px)',
          bgcolor: theme => alpha(theme.palette.background.paper, 0.85),
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar>
          {mobile && (
            <IconButton color="inherit" onClick={() => setOpen(true)}>
              <MenuRounded />
            </IconButton>
          )}
          <Typography sx={{ flexGrow: 1, fontWeight: 800 }}>
            نظام إدارة وتشغيل الأصول والمعدات
          </Typography>
          {setMode && (
            <IconButton
              aria-label="تغيير المظهر"
              onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
            >
              {mode === 'dark' ? <LightModeRounded /> : <DarkModeRounded />}
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Box component="nav">
        <Drawer
          anchor="right"
          variant={mobile ? 'temporary' : 'permanent'}
          open={mobile ? open : true}
          onClose={() => setOpen(false)}
          slotProps={{ transition: { direction: 'left' } }}
          sx={{ '& .MuiDrawer-paper': { width, boxSizing: 'border-box' } }}
        >
          {menu}
        </Drawer>
        {app && <WipeDialog open={wipe} onClose={() => setWipe(false)} />}
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, md: 4 },
          mr: mobile ? 0 : `${width}px`,
          mt: 8,
          minWidth: 0,
        }}
      >
        {!online && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            غير متصل — وضع القراءة فقط (جميع عمليات الإضافة والتعديل والحذف والاستعادة معطلة حتى عودة الاتصال)
          </Alert>
        )}
        <Outlet />
      </Box>

      <Snackbar open={!!notice} autoHideDuration={4000} onClose={() => setNotice?.(null)}>
        <Alert severity={notice?.type || 'info'} variant="filled">
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  );
}
