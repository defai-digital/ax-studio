import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { cn } from '@/lib/utils'
import { useState } from 'react'

const PATH_TRAVERSAL_RE = /(?:\.\.|\/\.\.|\.(?=\/))/
const VALID_PREFIX_RE = /^\/[a-zA-Z0-9_\-/]*$/

function sanitizePrefix(raw: string): string {
  let prefix = raw.trim().replace(/\\/g, '/')
  if (!prefix.startsWith('/')) {
    prefix = '/' + prefix
  }
  prefix = prefix.replace(/\/+/g, '/').replace(/\/+$/, '')
  if (PATH_TRAVERSAL_RE.test(prefix)) return ''
  if (!VALID_PREFIX_RE.test(prefix)) return ''
  return prefix || '/'
}

export function ApiPrefixInput({
  isServerRunning,
}: {
  isServerRunning?: boolean
}) {
  const { apiPrefix, setApiPrefix } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(apiPrefix)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const handleBlur = () => {
    const prefix = sanitizePrefix(inputValue)
    if (prefix) {
      setApiPrefix(prefix)
      setInputValue(prefix)
    } else {
      setInputValue(apiPrefix)
    }
  }

  return (
    <Input
      type="text"
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className={cn(
        'w-24 h-8 text-sm',
        isServerRunning && 'opacity-50 pointer-events-none'
      )}
      placeholder="/v1"
    />
  )
}
