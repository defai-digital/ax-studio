import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'
import { IconLoader2 } from '@tabler/icons-react'

type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root> & {
  loading?: boolean
}
function Switch({ loading, className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'relative peer cursor-pointer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-switch-background dark:data-[state=unchecked]:bg-input/80',
        loading && 'w-4.5 pointer-events-none',
        className
      )}
      {...props}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 size-3.5 top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2">
          <IconLoader2 className="animate-spin text-muted-foreground" />
        </div>
      )}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
          'bg-card dark:data-[state=unchecked]:bg-card-foreground dark:data-[state=checked]:bg-primary-foreground'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
