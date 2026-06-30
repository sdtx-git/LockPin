export type Size = 'xs' | 'sm' | 'base' | 'lg' | 'xl';

export type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';

export type Alignment = 'left' | 'center' | 'right';

export interface BaseComponentProps {
  className?: string;
  id?: string;
  'data-testid'?: string;
}

export interface DisableableProps {
  disabled?: boolean;
}

export interface LoadableProps {
  loading?: boolean;
}

export interface FormFieldProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  placeholder?: string;
  name?: string;
}

export type IconName =
  | 'search'
  | 'copy'
  | 'edit'
  | 'delete'
  | 'share'
  | 'star'
  | 'star-filled'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'settings'
  | 'user'
  | 'users'
  | 'plus'
  | 'minus'
  | 'check'
  | 'close'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'key'
  | 'shield'
  | 'globe'
  | 'refresh'
  | 'download'
  | 'upload'
  | 'folder'
  | 'file'
  | 'clock'
  | 'calendar'
  | 'info'
  | 'warning'
  | 'error'
  | 'success';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration?: number;
}
