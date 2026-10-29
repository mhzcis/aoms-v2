import { forwardRef } from 'react';
import { InputAdornment, TextField } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';

const AppTextField = forwardRef(function AppTextField({disabled,InputProps,slotProps,helperText,...props},ref) {
  const locked = disabled || InputProps?.readOnly || slotProps?.input?.readOnly;
  return <TextField {...props} ref={ref} disabled={disabled} slotProps={slotProps}
    className={`${props.className||''}${locked?' locked-field':''}`}
    helperText={locked ? <><span>🔒 {disabled?'حقل مغلق':'للقراءة فقط'}</span>{helperText && <> — {helperText}</>}</> : helperText}
    InputProps={{...InputProps,...(locked?{endAdornment:<>{InputProps?.endAdornment}<InputAdornment position="end"><LockOutlined fontSize="small" titleAccess="حقل مغلق" /></InputAdornment></>}: {})}} />;
});
export default AppTextField;
