import { writable, type Readable, type Writable } from "svelte/store";
import type { zapSystem, zapSystems, htmlFormattedSearchRes, zapSearchResults, ConfigData, EspMessage, writeResultState, sourceZapSvs, sourceZapSvsList, indexingMessage, mappings, mapping } from "../types/ConfigData";
import {v4 as uuidv4} from 'uuid';
import { EspUtils, } from "./EspUtils";
import { LogUtils } from "./LogUtils";
import { UIDUtils } from "../backend/UIDUtils";
import type { UIDExtdRecord } from "../types/ConfigData";
export class ZapUtils{
    private static retSystems: Writable<zapSystems> = writable({} as zapSystems);
    private static srchResults: Writable<zapSearchResults> = writable({} as zapSearchResults);
    private static htmlResults: Writable<htmlFormattedSearchRes> = writable({} as htmlFormattedSearchRes);
    private static bZapSvsConnected = false;
    private static currConfig: ConfigData;
    private static zapSvsSocket: WebSocket;
    private static isCreateModeEnabled = false;
    private static writeResultState: Writable<writeResultState> = writable({} as writeResultState);
    private static currZapSvs: string = "";
    private static currMappings: mappings;
    
    
    
    private static buildZapSocketURL(ip: string, path: string): string{
        return `ws://${ip}:7497${path}`;
    }

    static getBlankSystem(): zapSystem {
        return {} as zapSystem;
    }

    static getBlankSystems(): zapSystems {
        return {} as zapSystems;
    }

    static getBlankSearchResults(): zapSearchResults {
        return {} as zapSearchResults;
    }

    private static getBlankESPMsg(): EspMessage{
        return {} as EspMessage;
    }

    static getBlankhmtlSrchRes(): htmlFormattedSearchRes{
        return {} as htmlFormattedSearchRes;
    }

    static getBlankWriteState(): writeResultState{
        return {} as writeResultState;
    }

    private static getBlankSourceZapSvs(): sourceZapSvs{
        return {} as sourceZapSvs;
    }

    private static getBlankSourceZapSvsList(): sourceZapSvsList{
        return {} as sourceZapSvsList;
    }

    static getBlankIndexingMsg(): indexingMessage{
        return {} as indexingMessage;
    }

    static getBlankMappings(): mappings{
        return {} as mappings;
    }
    static getBlankMapping(): mapping{
        return {} as mapping;
    }

    static getActiveSourceList(): sourceZapSvsList{
        EspUtils.config().subscribe(value=> this.currConfig = value);
        if(this.bZapSvsConnected){
            this.zapSvsSocket.close();
            this.srchResults.set(this.getBlankSearchResults());
            this.retSystems.set(this.getBlankSystems());
        }
        let newZapSvs = null;
        let newZapSvsList = this.getBlankSourceZapSvsList();
        newZapSvsList.sources = [];
        if(this.currConfig.steamEnabled){
            newZapSvs = this.getBlankSourceZapSvs();
            newZapSvs.name = "Zaparoo For Steam";
            newZapSvs.value = "steam";
            newZapSvsList.sources.push(newZapSvs);
        }
        if(this.currConfig.zapEnabled){
            newZapSvs = this.getBlankSourceZapSvs();
            newZapSvs.name = "Zaparoo";
            newZapSvs.value = "zaparoo";
            newZapSvsList.sources.push(newZapSvs);
        }
        newZapSvs = this.getBlankSourceZapSvs();
        newZapSvs.name = "Manual";
        newZapSvs.value = "manual";
        newZapSvsList.sources.push(newZapSvs);
        return newZapSvsList;
    }

    static initConnection(source: string){
        if(this.bZapSvsConnected){
            this.zapSvsSocket.close();
            this.srchResults.set(this.getBlankSearchResults());
        }
        this.currZapSvs = source;
        switch(source){
            case "steam":
                this.initConn(this.buildZapSocketURL(this.currConfig.steamIp, this.currConfig.zapWsPath));
                break;
            case "zaparoo":
                this.initConn(this.buildZapSocketURL(this.currConfig.zapIp, this.currConfig.zapWsPath));
                break;
        }
    }

    private static initConn(connPath: string) {
        this.zapSvsSocket = new WebSocket(connPath);
        this.zapSvsSocket.onopen    = this.connOnOpen.bind(this);
        this.zapSvsSocket.onclose   = this.connOnClose.bind(this);
        this.zapSvsSocket.onmessage = this.connOnMessage.bind(this);
        this.zapSvsSocket.onerror = this.connOnError.bind(this);
    }

    private static connOnOpen(){
        LogUtils.notify(`Connected to Zaparoo on ${this.currZapSvs}`);
        this.bZapSvsConnected = true;
        this.generateIndexedSystemsList();
        setTimeout(()=> this.generateMappingsList(), 1000);        
    }

    private static connOnClose(){
        //LogUtils.notify(`Disconnected From Zaparoo on ${this.currZapSvs}`);
        //console.log("zap conn closed");
        this.bZapSvsConnected = false;
    }

    private static connOnMessage(event: MessageEvent){
        const msgData = JSON.parse(event.data);
        //console.log("ZapSvs Msg: ", event.data);
        if(typeof(msgData.result) != "undefined"){
        if(msgData.result != null && typeof(msgData.result) === "object"){
            //return of Systems List
            if(typeof(msgData.result.systems) != "undefined"){
                let tmpSysList: zapSystems = msgData.result;
                this.processZaparooSystems(tmpSysList);
            }
            //return of search results
            if(typeof(msgData.result.results) != "undefined"){
                let tmpSearchRes: zapSearchResults = msgData.result;
                this.processSearchResults(tmpSearchRes);
            }
            //return of mappings list
            if(typeof(msgData.result.mappings) != "undefined"){
                let tmpMapRes: mappings = msgData.result;
                this.processMappings(tmpMapRes);
            }
        }else if(typeof(msgData.method) != "undefined"){
            //DB Indexing Status
            if((msgData.method) == "media.indexing"){
                let tmpIdxMsg = this.getBlankIndexingMsg();
                tmpIdxMsg.params = msgData.params;
                if(tmpIdxMsg.params.indexing){
                    LogUtils.notify(`Indexing: ${tmpIdxMsg.params.currentStepDisplay} - Step: ${tmpIdxMsg.params.currentStep} of ${tmpIdxMsg.params.totalSteps}`);
                }else if(!tmpIdxMsg.params.indexing && typeof(tmpIdxMsg.params.totalFiles) != "undefined"){
                    LogUtils.notify(`Indexing Complete: Total Files Indexed = ${tmpIdxMsg.params.totalFiles}`);
                }
            }
        }
    }

    private static connOnError(){
        LogUtils.notify("Unable to connect to Zaparoo: Check IP/service is running & reload window");
        this.bZapSvsConnected = false;
    }  
    
    private static processMappings(retMapList: mappings){
        this.currMappings = retMapList;
    }

    private static processSearchResults(recSearchRes: zapSearchResults){
        if(recSearchRes.total > 250){
            LogUtils.notify(`Max 250 results Shown (${recSearchRes.total}) - Refine your search`);
        }
        let tmpHtmlSR = this.getBlankhmtlSrchRes();
        tmpHtmlSR.results = [];
        for (let i = 0; i < recSearchRes.results.length; i++) {
            tmpHtmlSR.results.push({
                path: recSearchRes.results[i].path,
                name: `${recSearchRes.results[i].system.name} - ${recSearchRes.results[i].name}`
            });
        }
        this.srchResults.set(recSearchRes);
        this.htmlResults.set(tmpHtmlSR);
    }

    private static processZaparooSystems(recSysList: zapSystems){
        //only Sort & process results if Zaparoo else return special values for ESP32 routing launch command
        if(this.currZapSvs != "zaparoo"){
            let tmpObj = this.getBlankSystem(); 
            if(this.currZapSvs == "steam"){
                tmpObj.category = "steamOS";
                tmpObj.id = "steam";
                tmpObj.name = "Steam";
            }
            if(this.currZapSvs == "windows"){
                tmpObj.category = "windows";
                tmpObj.id = "windows";
                tmpObj.name = "Windows";
            }
            let tmpSysList = this.getBlankSystems();
            tmpSysList.systems=[];
            tmpSysList.systems.push(tmpObj);
            this.retSystems.set(tmpSysList);
        }else{
            recSysList.systems.sort(function (a: any, b: any) {
                if (a.name < b.name) {
                    return -1;
                }
                if (a.name > b.name) {
                    return 1;
                }
                return 0;
            });
            let tmpAllObj = {category: "all", id: "*", name:"All Systems"};
            recSysList.systems.unshift(tmpAllObj);
            this.retSystems.set(recSysList);
        }
    }

    static indexedSystemsList(): Readable<zapSystems> {
        return this.retSystems;
    }

    static htmlSrchRes(): Readable<htmlFormattedSearchRes>{
        return this.htmlResults;
    }

    static zapSrcRes(): Readable<zapSearchResults>{
        return this.srchResults;
    }

    static writeResStat(): Readable<writeResultState>{
        return this.writeResultState;
    }

    static mapList(): mappings{
        return this.currMappings;
    }

    static generateIndexedSystemsList(){        
        if(this.bZapSvsConnected){
            let newUUID = uuidv4();
            let wscmd = {
                jsonrpc: "2.0",
                id: newUUID,
                method: "systems"
            };
            //console.log("Sending Cmd to Zap Svs:", wscmd);
            this.zapSvsSocket.send(JSON.stringify(wscmd));
        }   
    }  

    static generateMappingsList(){        
        if(this.bZapSvsConnected){
            let newUUID = uuidv4();
            let wscmd = {
                jsonrpc: "2.0",
                id: newUUID,
                method: "mappings"
            };
            //console.log("Sending Cmd to Zap Svs:", wscmd);
            this.zapSvsSocket.send(JSON.stringify(wscmd));
        }   
    }

    static updateGamesDB(){
        //console.log("UpdatingDB");
        let newUUID = uuidv4();
        let wscmd = {
            jsonrpc: "2.0",
            id: newUUID,
            method: "media.index"
        };        
        this.zapSvsSocket.send(JSON.stringify(wscmd));
    }
    
    static doSearch(sysName: string, srchQuery: string | null) {
        let newUUID = uuidv4();
        let tmpParams;
        if(sysName != "*" && sysName != "steam"){
            tmpParams = {query: srchQuery, maxResults: 250, systems:[sysName]}
        }else{
            tmpParams = {query: srchQuery, maxResults: 250}
        }
        let wscmd = {
            jsonrpc: "2.0",
            id: newUUID,
            method: "media.search",
            params: tmpParams
        };
        this.zapSvsSocket.send(JSON.stringify(wscmd));
        if(this.bZapSvsConnected){
            LogUtils.notify(`Searching`);
            //console.log("zapsvs cmd:", wscmd)
            this.zapSvsSocket.send(JSON.stringify(wscmd));
        }
    }

    static doTestLaunch(launchPath: string){
        let newCMD = this.getBlankESPMsg();
        newCMD.cmd = "Test_Tag_Launch_Game";
        newCMD.data = launchPath;
        EspUtils.sendMessage(newCMD);
        LogUtils.notify(`Sent Launch Cmd for: ${launchPath}`);
    }

    static doWriteCard(launchPath: string, aLaunchP: string | null, aRemoveP: string | null){
        let tmpWRS = this.getBlankWriteState();
        tmpWRS.state = 0;        
        this.writeResultState.set(tmpWRS);
        let newCMD = this.getBlankESPMsg();
        if(!aLaunchP){aLaunchP = ""};
        if(!aRemoveP){aRemoveP = ""};
        newCMD.cmd = "write_Tag_Launch_Game";
        newCMD.data = {
            launchData: launchPath.trim(),
            audioLaunchPath: aLaunchP,
            audioRemovePath: aRemoveP
        }
        //console.log("write cmd: ", newCMD);
        EspUtils.sendMessage(newCMD);
    }

    static toggleCreateMode(isEnabled: boolean){
        this.isCreateModeEnabled = isEnabled;
        let newCMD = this.getBlankESPMsg();
        //console.log(`Setting Create Mode : ${this.isCreateModeEnabled}`);
        newCMD.cmd = "set_WriteMode";
        newCMD.data = this.isCreateModeEnabled;
        EspUtils.sendMessage(newCMD);
    }    

    static handleWriteResults(isSuccess: boolean, isCardDetected: boolean){
        let tmpWRS = this.getBlankWriteState();
        if(isSuccess){
            tmpWRS.state = 1;
        }else if(!isSuccess && isCardDetected){
            //write failed
            tmpWRS.state = 2;
        }else if(!isSuccess && !isCardDetected){
            //write failed no card detetcted
            tmpWRS.state = 3;
        }
        this.writeResultState.set(tmpWRS);        
    }

    static doWriteZapScript(currUID: string, launchPath: string, aLaunchP: string | null, aRemoveP: string | null){
        let newUUID = uuidv4();
        if(!aLaunchP){aLaunchP = ""};
        if(!aRemoveP){aRemoveP = ""};
        let mapID:number|undefined =  0;
        let wscmd = {};
        let tmpMapping:mapping = this.getBlankMapping();                
        let curMapRec = this.currMappings.mappings.filter((item: {pattern: string}) => (item.pattern == currUID));
        if(curMapRec.length !== 0){
            mapID = curMapRec[0].id;
        }        
        if (mapID != 0){
            tmpMapping.id = Number(mapID),
            tmpMapping.enabled = true,
            tmpMapping.match = "exact",
            tmpMapping.override = launchPath,
            tmpMapping.pattern = currUID,
            tmpMapping.type = "uid"
            wscmd = {
                jsonrpc: "2.0",
                id: newUUID,
                method: "mappings.update",
                params: tmpMapping
            };
        }else {
            tmpMapping.enabled = true,
            tmpMapping.match = "exact",
            tmpMapping.override = launchPath,
            tmpMapping.pattern = currUID,
            tmpMapping.type = "uid"
            wscmd = {
                jsonrpc: "2.0",
                id: newUUID,
                method: "mappings.new",
                params: tmpMapping
            };
        }
        //console.log("wscmd: ", wscmd)
        this.zapSvsSocket.send(JSON.stringify(wscmd));
        let tmpUIDRec = UIDUtils.getBlank();
        tmpUIDRec.UID = currUID;
        tmpUIDRec.launchAudio = aLaunchP;
        tmpUIDRec.removeAudio = aRemoveP;
        UIDUtils.updateUIDRecord(tmpUIDRec);
        UIDUtils.setUIDMode(false);        
    }

}