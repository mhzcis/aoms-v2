import { alpha, createTheme } from '@mui/material/styles';

export const makeTheme = mode => {
  const isDark = mode === 'dark';
  const primaryMain = '#0f766e';
  const secondaryMain = '#f59e0b';

  return createTheme({
    direction: 'rtl',
    palette: {
      mode,
      primary: {
        main: primaryMain,
        light: '#14b8a6',
        dark: '#115e59',
      },
      secondary: {
        main: secondaryMain,
        light: '#fbbf24',
        dark: '#d97706',
      },
      background: {
        default: isDark ? '#07111f' : '#f4f7fb',
        paper: isDark ? '#101c2c' : '#ffffff',
      },
      divider: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)',
    },
    shape: {
      borderRadius: 16,
    },
    typography: {
      fontFamily: '"Tajawal", "Cairo", "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif',
      h4: {
        fontWeight: 800,
        letterSpacing: '-0.01em',
      },
      h6: {
        fontWeight: 700,
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            fontWeight: 700,
            textTransform: 'none',
            transition: 'all 0.2s ease',
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
            '&.MuiInputLabel-outlined': {
              transform: 'translate(-14px, 16px) scale(1)',
            },
            '&.MuiInputLabel-outlined.MuiInputLabel-sizeSmall': {
              transform: 'translate(-14px, 9px) scale(1)',
            },
            '&.MuiInputLabel-outlined.MuiInputLabel-shrink': {
              transform: 'translate(-14px, -9px) scale(0.75)',
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
          },
          notchedOutline: {
            textAlign: 'right',
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
              fontWeight: 700,
              backgroundColor: isDark ? '#152338' : '#f8fafc',
              borderBottom: `2px solid ${alpha(primaryMain, 0.22)}`,
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            textAlign: 'right',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            textAlign: 'right',
            borderRadius: 12,
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
            fontWeight: 600,
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
            borderRadius: 12,
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
      MuiCard: {
        styleOverrides: {
          root: {
            border: '1px solid',
            borderColor: isDark ? '#223047' : '#e4eaf2',
            backgroundImage: 'none',
            boxShadow: isDark
              ? '0 12px 32px rgba(0, 0, 0, 0.35)'
              : '0 12px 32px rgba(15, 23, 42, 0.07)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
          },
        },
      },
    },
  });
};
