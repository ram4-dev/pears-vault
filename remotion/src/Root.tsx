import { Composition } from 'remotion'
import { HackvaultDemo } from './HackvaultDemo'

export const HackvaultVideo = () => (
  <Composition
    id="HackvaultDemo"
    component={HackvaultDemo}
    durationInFrames={720}
    fps={30}
    width={1280}
    height={720}
  />
)
