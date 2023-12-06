import configFile from "./project-config.json"

export interface ProjectConfig {
    namePrefix: string,
    service: {
        cpu: number
        memory: number
    }
    dashboard: {
        name: string
    }
}

const config = <ProjectConfig>configFile

export default config