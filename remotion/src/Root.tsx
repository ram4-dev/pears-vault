import { Composition } from 'remotion'
import { HackvaultDemo } from './HackvaultDemo'

export const HackvaultVideo = () => (
  <Composition
    id="HackvaultDemo"
    component={HackvaultDemo}
    durationInFrames={450}
    fps={30}
    width={1280}
    height={720}
  />
)
