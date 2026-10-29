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

const width = 285;

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

const ROLE_ARABIC = {
  admin: 'مدير النظام',
  operator: 'مشغل ميداني',
  viewer: 'مراقب (قراءة فقط)',
};

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
    <Box
      sx={{
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: theme =>
          theme.palette.mode === 'dark'
            ? 'linear-gradient(180deg, #0d1829 0%, #091220 100%)'
            : 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      }}
    >
      <Box
        sx={{
          p: 1.75,
          borderRadius: 3.5,
          background: theme =>
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(20, 184, 166, 0.22) 0%, rgba(14, 165, 233, 0.14) 100%)'
              : 'linear-gradient(135deg, rgba(15, 118, 110, 0.12) 0%, rgba(2, 132, 199, 0.08) 100%)',
          border: '1px solid',
          borderColor: theme => alpha(theme.palette.primary.main, 0.24),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2.5,
              background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.05rem',
              boxShadow: '0 4px 12px rgba(15, 118, 110, 0.35)',
            }}
          >
            ⚙️
          </Box>
          <Box>
            <Typography
              variant="h6"
              color="primary"
              sx={{ fontWeight: 800, lineHeight: 1.25, fontSize: '0.95rem' }}
            >
              إدارة وتشغيل الأصول والمعدات
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              بوابة الأصول والتشغيل
            </Typography>
          </Box>
        </Box>
        <Chip
          size="small"
          color={online ? 'success' : 'warning'}
          label={online ? 'متصل' : 'قراءة فقط'}
        />
      </Box>

      <List sx={{ mt: 1.5, flexGrow: 1, overflowY: 'auto', pr: 0.25 }}>
        {visibleLinks.map(([to, t, IconComp]) => (
          <ListItemButton
            component={NavLink}
            to={to}
            end={to === '/'}
            key={to}
            onClick={() => setOpen(false)}
            sx={{
              mb: 0.6,
              py: 1.1,
              px: 1.5,
              borderRadius: 3,
              '&.active': {
                bgcolor: 'primary.main',
                color: '#fff',
                '& .MuiListItemIcon-root': { color: '#fff' },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 34, color: 'text.secondary' }}>
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
          <Box
            sx={{
              p: 1.25,
              mb: 1.25,
              borderRadius: 3,
              bgcolor: theme => alpha(theme.palette.primary.main, 0.06),
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box sx={{ textAlign: 'center', mb: 0.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                <Box
                  role="status"
                  aria-label={online ? 'متصل بالإنترنت' : 'غير متصل بالإنترنت'}
                  title={online ? 'متصل بالإنترنت' : 'غير متصل بالإنترنت'}
                  sx={{
                    width: 10,
                    height: 10,
                    flexShrink: 0,
                    borderRadius: '50%',
                    bgcolor: online ? '#22c55e' : '#ef4444',
                    boxShadow: online
                      ? '0 0 0 3px rgba(34, 197, 94, 0.25), 0 0 10px 2px rgba(34, 197, 94, 0.75)'
                      : '0 0 0 3px rgba(239, 68, 68, 0.25), 0 0 10px 2px rgba(239, 68, 68, 0.75)',
                    transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
                  }}
                />
                <Typography variant="body2" fontWeight={800} sx={{ lineHeight: 1.25 }}>
                  {profile?.full_name || 'مستخدم'}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" component="div">
                {ROLE_ARABIC[profile?.role] || profile?.role || 'viewer'} ({profile?.role || 'viewer'})
              </Typography>
            </Box>
            <Button
              fullWidth
              size="small"
              variant="outlined"
              startIcon={<LogoutRounded />}
              color="error"
              onClick={signOut}
              sx={{ mt: 0.5, justifyContent: 'center' }}
            >
              تسجيل الخروج
            </Button>
          </Box>
        )}

        <Box
          sx={{
            p: 1.25,
            borderRadius: 2.5,
            textAlign: 'center',
            color: 'text.secondary',
            bgcolor: 'action.hover',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" component="div">
            برمجة وتطوير:
          </Typography>
          <Typography variant="caption" component="div" fontWeight={800} color="text.primary">
            م. محمد أبو زهري
          </Typography>
          <Typography variant="caption" component="div" sx={{ mt: 0.5, fontSize: '0.72rem' }}>
            صُنع بكل حب <span style={{ color: '#e11d48' }}>♥️</span>
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%', overflowX: 'hidden' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          right: mobile ? 0 : `${width}px`,
          left: 0,
          width: mobile ? '100%' : `calc(100% - ${width}px)`,
          backdropFilter: 'blur(16px)',
          bgcolor: theme => alpha(theme.palette.background.paper, 0.88),
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between', gap: 1.5, minHeight: { xs: 60, md: 68 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {mobile && (
              <IconButton
                color="inherit"
                aria-label="فتح القائمة"
                onClick={() => setOpen(true)}
                sx={{
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <MenuRounded />
              </IconButton>
            )}
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: { xs: '0.95rem', sm: '1.1rem', md: '1.2rem' },
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              نظام إدارة وتشغيل الأصول والمعدات
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {!mobile && (
              <Chip
                size="small"
                color={online ? 'success' : 'warning'}
                variant="outlined"
                label={online ? 'متصل بالسحابة اللحظية' : 'وضع القراءة فقط'}
              />
            )}
            {setMode && (
              <IconButton
                aria-label="تغيير المظهر"
                title={mode === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
                onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                sx={{
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                  color: mode === 'dark' ? 'secondary.main' : 'primary.main',
                }}
              >
                {mode === 'dark' ? <LightModeRounded /> : <DarkModeRounded />}
              </IconButton>
            )}
          </Box>
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
          p: { xs: 2, sm: 3, md: 4 },
          mr: mobile ? 0 : `${width}px`,
          mt: { xs: 7.5, md: 8.5 },
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        {!online && (
          <Alert severity="warning" sx={{ mb: 2.5 }}>
            غير متصل — وضع القراءة فقط (جميع عمليات الإضافة والتعديل والحذف والاستعادة معطلة حتى عودة الاتصال)
          </Alert>
        )}
        {aoms?.error && <Alert severity="error" role="alert" onClose={() => aoms.setError('')} sx={{ mb: 2, overflowWrap: 'anywhere' }}>{aoms.error}</Alert>}
        <Outlet />
      </Box>

      <Snackbar open={!!notice} autoHideDuration={notice?.type === 'error' ? null : 4000} onClose={(_, reason) => reason !== 'clickaway' && setNotice?.(null)}>
        <Alert severity={notice?.type || 'info'} variant="filled" onClose={() => setNotice?.(null)}>
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  );
}
