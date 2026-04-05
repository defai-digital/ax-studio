import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { Switch } from '@/components/ui/switch'

export function TokenCounterCompactSwitcher() {
  const { tokenCounterCompact, setTokenCounterCompact } = useGeneralSetting()

  const toggleTokenCounterCompact = () => {
    setTokenCounterCompact(!tokenCounterCompact)
  }

  return (
    <Switch
      checked={tokenCounterCompact}
      onCheckedChange={toggleTokenCounterCompact}
    />
  )
}
