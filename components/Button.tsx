
import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  isLoading,
  disabled,
  className = '',
}) => {
  const baseStyles = "inline-flex items-center justify-center font-semibold transition-all duration-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2";
  
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200",
    secondary: "bg-slate-800 text-white hover:bg-slate-900",
    outline: "bg-transparent border border-slate-200 text-slate-600 hover:bg-slate-50",
    danger: "bg-red-500 text-white hover:bg-red-600",
  };

  const sizes = {
    sm: "px-3 py-2 text-sm",
    md: "px-5 py-2.5 text-sm",
    lg: "px-8 py-4 text-base",
  };

  // We'll use inline styles to ensure it works without external CSS files
  const styles: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    borderRadius: '0.75rem',
    transition: 'all 0.2s ease',
    cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    border: 'none',
    gap: '0.5rem',
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: '#4f46e5', color: 'white', boxShadow: '0 10px 15px -3px rgba(79, 70, 229, 0.3)' },
    secondary: { backgroundColor: '#1e293b', color: 'white' },
    outline: { backgroundColor: 'transparent', border: '1px solid #e2e8f0', color: '#475569' },
    danger: { backgroundColor: '#ef4444', color: 'white' },
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '0.5rem 0.75rem', fontSize: '0.875rem' },
    md: { padding: '0.625rem 1.25rem', fontSize: '0.875rem' },
    lg: { padding: '1rem 2rem', fontSize: '1rem' },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      style={{ ...styles, ...variantStyles[variant], ...sizeStyles[size] }}
    >
      {isLoading ? (
        <span className="spinner" style={{
          width: '1rem',
          height: '1rem',
          border: '2px solid rgba(255,255,255,0.3)',
          borderTopColor: 'white',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
      ) : children}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </button>
  );
};
