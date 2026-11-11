'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { motion, useReducedMotion, type Transition, type Variants } from 'motion/react';

import { cn } from '@/lib/utils';

export const spring: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
  mass: 0.7,
};

export const easeOut = [0.22, 1, 0.36, 1] as const;

type MotionProps = { children: ReactNode; className?: string };

// Reveals inside a Stagger inherit orchestration from the parent instead of self-animating.
const StaggerContext = createContext(false);

/*
 * Starting opacity never drops to 0, so a page is always legible even if
 * hydration is slow or JS fails. Blur is cleared on completion so no lingering
 * `filter` creates a containing block for fixed-position descendants.
 */
const revealVariants: Variants = {
  hidden: { opacity: 0.35, y: 8, filter: 'blur(3px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { ...spring, opacity: { duration: 0.35, ease: easeOut } },
    transitionEnd: { filter: 'none' },
  },
};

const staggerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.03 } },
};

export function PageTransition({ children, className }: MotionProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn('min-w-0', className)}
      initial={reduce ? false : { opacity: 0.5, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, opacity: { duration: 0.3, ease: easeOut } }}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className }: MotionProps) {
  const reduce = useReducedMotion();
  return (
    <StaggerContext.Provider value>
      <motion.div
        className={className}
        variants={staggerVariants}
        initial={reduce ? false : 'hidden'}
        animate="show"
      >
        {children}
      </motion.div>
    </StaggerContext.Provider>
  );
}

export function Reveal({ children, className }: MotionProps) {
  const reduce = useReducedMotion();
  const inStagger = useContext(StaggerContext);

  if (inStagger) {
    return (
      <motion.div className={className} variants={revealVariants}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={className}
      variants={revealVariants}
      initial={reduce ? false : 'hidden'}
      animate="show"
    >
      {children}
    </motion.div>
  );
}
