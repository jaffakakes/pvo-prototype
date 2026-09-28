import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { CreateProjectPage } from "./CreateProjectPage";

type Props = ComponentProps<typeof CreateProjectPage> & { wide: boolean; mobileView: ReactNode };

/** Keep staged desktop uploads alive when a window temporarily becomes phone-sized. */
export function CreateEntry({ wide, mobileView, ...props }: Props) {
  const [visited, setVisited] = useState(wide);
  useEffect(() => { if (wide) setVisited(true); }, [wide]);
  return <>
    {(wide || visited) && <div className="createEntry" hidden={!wide}>
      <CreateProjectPage {...props} active={wide} />
    </div>}
    {!wide && mobileView}
  </>;
}
