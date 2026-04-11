import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

type CardProps = {
  title?: string
  children?: ReactNode
  header?: ReactNode
}

type CardItemProps = {
  title?: string | ReactNode
  description?: string | ReactNode
  descriptionOutside?: string | ReactNode
  align?: 'start' | 'center' | 'end'
  actions?: ReactNode
  column?: boolean
  className?: string
  classNameWrapperAction?: string
}

export function CardItem({
  title,
  description,
  descriptionOutside,
  className,
  classNameWrapperAction,
  align = 'center',
  column,
  actions,
}: CardItemProps) {
  return (
    <>
      <div
        className={cn(
          'flex justify-between gap-6 px-5 py-4',
          'border-b border-border/40 last:border-none',
          descriptionOutside && 'border-0',
          align === 'start' && 'items-start',
          align === 'center' && 'items-center',
          align === 'end' && 'items-end',
          column && 'flex-col gap-y-2 items-start',
          className
        )}
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          {title && (
            <div className="font-medium text-foreground" style={{ fontSize: '13px' }}>
              {title}
            </div>
          )}
          {description && (
            <div className="text-muted-foreground leading-relaxed" style={{ fontSize: '12px' }}>
              {description}
            </div>
          )}
        </div>
        {actions && (
          <div
            className={cn(
              'shrink-0',
              classNameWrapperAction,
              column && 'w-full'
            )}
          >
            {actions}
          </div>
        )}
      </div>
      {descriptionOutside && (
        <div className="px-5 pb-4 text-muted-foreground leading-relaxed" style={{ fontSize: '12px' }}>
          {descriptionOutside}
        </div>
      )}
    </>
  )
}

export function Card({ title, children, header }: CardProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden w-full">
      {header && <div className="px-5 pt-5">{header}</div>}
      {title && (
        <div className="px-5 pt-5 pb-1">
          <h2 className="text-foreground font-semibold tracking-tight" style={{ fontSize: '14px' }}>
            {title}
          </h2>
        </div>
      )}
      {children}
    </div>
  )
}
