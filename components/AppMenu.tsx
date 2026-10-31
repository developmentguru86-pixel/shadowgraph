import {Menu,ChevronDown,ArrowUpRight,ArrowRight} from "lucide-react";
import {Button} from "./Button";
import styles from "./AppMenu.module.css";
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuLabel,DropdownMenuItem} from "./DropdownMenu";
import {STAGES,BUILD_LINKS} from "../helpers/productMap";

/** Global menu: the four steps of the product in order, and the building blocks that serve all of them. */
export function AppMenu(){
 return <DropdownMenu>
  <DropdownMenuTrigger asChild><Button className={styles.trigger} variant="outline" aria-label="Open navigation menu"><Menu size={14}/>Menu<ChevronDown size={12}/></Button></DropdownMenuTrigger>
  <DropdownMenuContent className={styles.content} align="end" sideOffset={14} aria-label="Product steps" collisionPadding={12}>
   <div className={styles.top}><div><span className={styles.kicker}>ShadowGraph / Infrastructure dependency intelligence</span><strong>Map it. Watch it. Prove it. Price it.</strong></div><DropdownMenuItem className={styles.home} asChild><a href="/">Home <ArrowUpRight size={14}/></a></DropdownMenuItem></div>
   <div className={styles.columns}>{STAGES.map((stage)=><div className={styles.category} key={stage.key}>
    <DropdownMenuLabel className={styles.label}><span>{stage.n}</span>{stage.name}</DropdownMenuLabel>
    <p className={styles.description}>{stage.question}</p>
    {stage.links.map(({label,href,hint})=><DropdownMenuItem className={styles.item} key={href} asChild><a href={href}><span><b>{label}</b><small>{hint}</small></span><ArrowRight size={12}/></a></DropdownMenuItem>)}
   </div>)}</div>
   <div className={styles.bottom}><span>Build on it</span><span className={styles.build}>{BUILD_LINKS.map((l)=><DropdownMenuItem className={styles.buildItem} key={l.href} asChild><a href={l.href}>{l.label}</a></DropdownMenuItem>)}</span></div>
  </DropdownMenuContent>
 </DropdownMenu>;
}