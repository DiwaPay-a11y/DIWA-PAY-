import React from 'react';

interface DiwaPayLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  className?: string;
}

export const DiwaPayLogo: React.FC<DiwaPayLogoProps> = ({
  size = 'lg',
  showWordmark = true,
  className = '',
}) => {
  const dimensions = {
    sm: { iconW: 48, iconH: 44, textClass: 'text-lg tracking-tight' },
    md: { iconW: 72, iconH: 66, textClass: 'text-2xl tracking-tight' },
    lg: { iconW: 102, iconH: 94, textClass: 'text-[27px] leading-none tracking-[-0.01em]' },
  }[size];

  const gradientId = React.useId();

  return (
    <div className={`inline-flex flex-col items-center select-none ${className}`}>
      <svg
        width={dimensions.iconW}
        height={dimensions.iconH}
        viewBox="0 0 116 106"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="12"
            y1="8"
            x2="104"
            y2="98"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FCE79C" />
            <stop offset="48%" stopColor="#E6BA52" />
            <stop offset="100%" stopColor="#C88E2B" />
          </linearGradient>
        </defs>

        {/* Stylized geometric 'd' (left bowl + tall right stem, circular counter) */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M39 8H54V51C54 64.8071 42.8071 76 29 76C15.1929 76 4 64.8071 4 51C4 37.1929 15.1929 26 29 26C32.6345 26 36.0873 26.7759 39 28.1726V8ZM29 44.5C25.4101 44.5 22.5 47.4101 22.5 51C22.5 54.5899 25.4101 57.5 29 57.5C32.5899 57.5 35.5 54.5899 35.5 51C35.5 47.4101 32.5899 44.5 29 44.5Z"
          fill={`url(#${gradientId})`}
        />

        {/* Stylized geometric 'p' (tall descending left stem + right bowl, circular counter) */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M77 98H62V55C62 41.1929 73.1929 30 87 30C100.807 30 112 41.1929 112 55C112 68.8071 100.807 80 87 80C83.3655 80 79.9127 79.2241 77 77.8274V98ZM87 61.5C90.5899 61.5 93.5 58.5899 93.5 55C93.5 51.4101 90.5899 48.5 87 48.5C83.4101 48.5 80.5 51.4101 80.5 55C80.5 58.5899 83.4101 61.5 87 61.5Z"
          fill={`url(#${gradientId})`}
        />
      </svg>

      {showWordmark && (
        <span
          className={`mt-2.5 font-semibold bg-clip-text text-transparent ${dimensions.textClass}`}
          style={{
            fontFamily: 'var(--font-display)',
            backgroundImage: 'linear-gradient(135deg, #FCE79C 0%, #E7BA52 52%, #C9912E 100%)',
          }}
        >
          DiwaPAY
        </span>
      )}
    </div>
  );
};
