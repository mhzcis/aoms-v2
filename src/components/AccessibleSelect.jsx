import { Select, useFormControl } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';

export default function AccessibleSelect({ label, inputProps, ...props }) {
  const form=useFormControl();const locked=props.disabled??form?.disabled;
  return <Select label={label} {...props} {...(locked ? { IconComponent: LockOutlined } : {})} inputProps={{ 'aria-label': locked ? `${label} — حقل مغلق` : label, ...inputProps }} />;
}
