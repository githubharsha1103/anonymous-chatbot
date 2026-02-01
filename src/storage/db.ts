import * as fs from "fs";

const FILE = "src/storage/users.json";
const BANS_FILE = "src/storage/bans.json";

function read() {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}");
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function write(data:any) {
  fs.writeFileSync(FILE, JSON.stringify(data,null,2));
}

export function readBans() {
  if (!fs.existsSync(BANS_FILE)) fs.writeFileSync(BANS_FILE, "[]");
  return JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
}

function writeBans(data:any) {
  fs.writeFileSync(BANS_FILE, JSON.stringify(data,null,2));
}

export function getUser(id:number){
  const db = read();
  if(!db[id]){
    db[id] = {
      name: null,
      gender:null,
      age:null,
      state:null,
      premium:false,
      daily:0,
      preference:"any",
      lastPartner:null,
      reportingPartner:null,
      reportReason:null,
      isAdminAuthenticated:false,
      chatStartTime:null
    };
    write(db);
    return { ...db[id], isNew: true };
  }
  return db[id];
}

export function updateUser(id:number,data:any){
  const db = read();
  db[id] = {...getUser(id), ...data};
  write(db);
}

export function incDaily(id:number){
  const db = read();
  db[id].daily++;
  write(db);
}

export function setGender(id: number, gender: string) {
  updateUser(id, { gender });
}

export function getGender(id: number) {
  return getUser(id).gender;
}

export function setState(id: number, state: string) {
  updateUser(id, { state });
}

export function getState(id: number) {
  return getUser(id).state;
}

export function setAge(id: number, age: string) {
  updateUser(id, { age });
}

export function getAge(id: number) {
  return getUser(id).age;
}

export function banUser(id: number) {
  const bans = readBans();
  if (!bans.includes(id)) {
    bans.push(id);
    writeBans(bans);
  }
}

export function unbanUser(id: number) {
  const bans = readBans();
  const index = bans.indexOf(id);
  if (index > -1) {
    bans.splice(index, 1);
    writeBans(bans);
  }
}

export function isBanned(id: number) {
  const bans = readBans();
  return bans.includes(id);
}

export function getAllUsers() {
  const db = read();
  return Object.keys(db);
}

export function getReportCount(id: number) {
  const user = getUser(id);
  return user.reportCount || 0;
}

export function getBanReason(id: number) {
  const user = getUser(id);
  return user.banReason || null;
}

export function deleteUser(id: number) {
  const db = read();
  if (db[id]) {
    delete db[id];
    write(db);
    return true;
  }
  return false;
}
