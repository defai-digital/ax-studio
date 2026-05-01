import type { ArtifactType } from '@/lib/artifacts/harness'

export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  html: 'HTML',
  react: 'React',
  svg: 'SVG',
  chartjs: 'Chart.js',
  vega: 'Vega-Lite',
}
