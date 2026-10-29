import { Select } from '@mui/material';

export default function AccessibleSelect({ label, inputProps, ...props }) {
  return <Select label={label} {...props} inputProps={{ 'aria-label': label, ...inputProps }} />;
}
