import { alpha, createTheme } from '@mui/material/styles';

export const makeTheme = mode => {
  const isDark = mode === 'dark';
  const primaryMain = isDark ? '#14b8a6' : '#0f766e';
  const secondaryMain = isDark ? '#fbbf24' : '#d97706';

  return createTheme({
    direction: 'rtl',
    palette: {
      mode,
      primary: {
        main: primaryMain,
        light: '#2dd4bf',
        dark: '#115e59',
        contrastText: isDark ? '#042f2e' : '#ffffff',
      },
      secondary: {
        main: secondaryMain,
        light: '#fcd34d',
        dark: '#b45309',
        contrastText: isDark ? '#451a03' : '#ffffff',
      },
      error: {
        main: isDark ? '#f87171' : '#dc2626',
        light: '#fca5a5',
        dark: '#991b1b',
      },
      warning: {
        main: isDark ? '#fbbf24' : '#d97706',
        light: '#fde68a',
        dark: '#92400e',
      },
      info: {
        main: isDark ? '#38bdf8' : '#0284c7',
        light: '#7dd3fc',
        dark: '#075985',
      },
      success: {
        main: isDark ? '#34d399' : '#059669',
        light: '#6ee7b7',
        dark: '#065f46',
      },
      text: {
        primary: isDark ? '#f1f5f9' : '#0f172a',
        secondary: isDark ? '#94a3b8' : '#475569',
      },
      background: {
        default: isDark ? '#060d18' : '#f1f5f9',
        paper: isDark ? '#0f1a2c' : '#ffffff',
      },
      divider: isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(15, 23, 42, 0.09)',
      action: {
        hover: isDark ? 'rgba(45, 212, 191, 0.08)' : 'rgba(15, 118, 110, 0.05)',
        selected: isDark ? 'rgba(45, 212, 191, 0.18)' : 'rgba(15, 118, 110, 0.12)',
      },
    },
    shape: {
      borderRadius: 16,
    },
    typography: {
      fontFamily: '"Tajawal", "Cairo", "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif',
      h2: {
        fontWeight: 800,
        letterSpacing: '-0.02em',
      },
      h4: {
        fontWeight: 800,
        letterSpacing: '-0.01em',
        lineHeight: 1.3,
      },
      h5: {
        fontWeight: 800,
        lineHeight: 1.35,
      },
      h6: {
        fontWeight: 700,
        lineHeight: 1.4,
      },
      subtitle1: {
        fontWeight: 700,
      },
      subtitle2: {
        fontWeight: 700,
      },
      body1: {
        lineHeight: 1.65,
      },
      body2: {
        lineHeight: 1.6,
      },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { ':root': { '--locked-input-color': isDark ? '#cbd5e1' : '#475569' } } },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            fontWeight: 700,
            textTransform: 'none',
            padding: '8px 18px',
            transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              transform: 'translateY(-1px)',
            },
          },
          containedPrimary: {
            background: isDark
              ? 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)'
              : 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)',
            color: '#ffffff',
            boxShadow: isDark
              ? '0 6px 20px rgba(20, 184, 166, 0.32)'
              : '0 6px 20px rgba(15, 118, 110, 0.25)',
          },
          // المسافة بين الأيقونة والنص في RTL: الأيقونة على يمين النص، فتكون المسافة 8px على جهتها اليسرى.
          startIcon: ({ ownerState }) => ({
            marginLeft: 8,
            marginRight: ownerState.size === 'small' ? -2 : -4,
          }),
          endIcon: ({ ownerState }) => ({
            marginRight: 8,
            marginLeft: ownerState.size === 'small' ? -2 : -4,
          }),
        },
      },
      // محاذاة RTL مركزية لعناصر MUI التي تفترض اتجاه LTR في أنماطها الافتراضية.
      MuiInputLabel: {
        styleOverrides: {
          root: {
            left: 'auto',
            right: 0,
            transformOrigin: 'top right',
            textAlign: 'right',
            fontWeight: 600,
            maxWidth: 'calc(100% - 28px)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            '&.MuiInputLabel-outlined': {
              transform: 'translate(-14px, 16px) scale(1)',
            },
            '&.MuiInputLabel-outlined.MuiInputLabel-sizeSmall': {
              transform: 'translate(-14px, 9px) scale(1)',
            },
            '&.MuiInputLabel-outlined.MuiInputLabel-shrink': {
              transform: 'translate(-14px, -9px) scale(0.75)',
              maxWidth: '130%',
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
            '&.Mui-focused': {
              boxShadow: `0 0 0 3px ${alpha(primaryMain, 0.18)}`,
            },
          },
          notchedOutline: {
            textAlign: 'right',
            borderColor: isDark ? 'rgba(148, 163, 184, 0.24)' : 'rgba(15, 23, 42, 0.14)',
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: {
            textAlign: 'right',
            '&[type=date]': {
              textAlign: 'right',
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          select: {
            '&&&': {
              paddingLeft: 32,
              paddingRight: 14,
            },
            textAlign: 'right',
          },
          icon: {
            right: 'auto',
            left: 7,
          },
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: {
            textAlign: 'right',
            fontWeight: 500,
          },
        },
      },
      MuiFormControlLabel: {
        styleOverrides: {
          root: {
            marginLeft: 16,
            marginRight: -11,
          },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-head': {
              fontWeight: 800,
              fontSize: '0.84rem',
              color: isDark ? '#5eead4' : '#115e59',
              backgroundColor: isDark ? '#132238' : '#f0fdfa',
              borderBottom: `2px solid ${alpha(primaryMain, 0.28)}`,
              whiteSpace: 'nowrap',
              paddingTop: 12,
              paddingBottom: 12,
            },
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: 'background-color 0.15s ease',
            '&:nth-of-type(even)': {
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(248, 250, 252, 0.75)',
            },
            '&:hover': {
              backgroundColor: isDark ? 'rgba(20, 184, 166, 0.1)' : 'rgba(15, 118, 110, 0.05)',
            },
            '&.Mui-selected': {
              backgroundColor: isDark ? 'rgba(245, 158, 11, 0.22)' : 'rgba(245, 158, 11, 0.14)',
              '&:hover': {
                backgroundColor: isDark ? 'rgba(245, 158, 11, 0.28)' : 'rgba(245, 158, 11, 0.2)',
              },
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            textAlign: 'right',
            borderColor: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.07)',
            padding: '10px 14px',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            textAlign: 'right',
            borderRadius: 12,
            transition: 'all 0.2s ease',
          },
        },
      },
      MuiListItemText: {
        styleOverrides: {
          root: {
            textAlign: 'right',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 20,
            border: '1px solid',
            borderColor: isDark ? 'rgba(45, 212, 191, 0.22)' : 'rgba(15, 118, 110, 0.14)',
            boxShadow: isDark
              ? '0 24px 64px rgba(0, 0, 0, 0.65)'
              : '0 24px 64px rgba(15, 23, 42, 0.18)',
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            textAlign: 'right',
            fontWeight: 800,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            textAlign: 'right',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 700,
            borderRadius: 999,
          },
          icon: {
            marginLeft: -6,
            marginRight: 5,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            fontWeight: 600,
          },
          icon: {
            marginRight: 0,
            marginLeft: 12,
          },
          action: {
            marginRight: 'auto',
            marginLeft: -8,
            paddingLeft: 0,
            paddingRight: 16,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            border: '1px solid',
            borderColor: isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(15, 23, 42, 0.08)',
            backgroundImage: 'none',
            boxShadow: isDark
              ? '0 14px 34px rgba(0, 0, 0, 0.42)'
              : '0 10px 28px rgba(15, 23, 42, 0.06)',
            transition: 'transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease',
          },
        },
      },
    },
  });
};
