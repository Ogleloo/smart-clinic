import type { ImgHTMLAttributes } from 'react'

export default function Image({ fill, priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) {
  void fill
  void priority
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt ?? ''} />
}
