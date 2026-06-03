import { ReactNode } from 'react';

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export const Skeleton = ({ className = '', width = '100%', height = '1rem' }: SkeletonProps) => (
  <div
    className={`bg-slate-200/80 dark:bg-slate-700/80 animate-pulse rounded-md ${className}`}
    style={{ width, height }}
  />
);

interface PageSkeletonProps {
  rows?: number;
}

const PageSkeleton = ({ rows = 4 }: PageSkeletonProps) => (
  <div className="space-y-8 py-10">
    <div className="space-y-3">
      <Skeleton className="h-10 w-1/3 rounded-xl" />
      <Skeleton className="h-4 w-2/3 rounded-lg" />
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="h-40 rounded-3xl md:col-span-2" />
    </div>

    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-8 rounded-xl md:col-span-1" />
          <Skeleton className="h-8 rounded-xl md:col-span-2" />
        </div>
      ))}
    </div>
  </div>
);

export default PageSkeleton;
