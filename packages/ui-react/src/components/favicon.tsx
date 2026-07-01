import { Fragment } from "react"

export function Favicon() {
  return (
    <Fragment>
      <link rel="icon" type="image/png" href="/favicon-96x96-v3.png" sizes="96x96" />
      <link rel="shortcut icon" href="/favicon-v3.ico" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v3.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <meta name="apple-mobile-web-app-title" content="Maximilian" />
    </Fragment>
  )
}