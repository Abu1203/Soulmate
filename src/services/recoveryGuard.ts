import AsyncStorage from '@react-native-async-storage/async-storage';
export const RECOVERY_JOURNAL='@soulmate_recovery_transaction';
export async function assertRecoveryReady(){if(await AsyncStorage.getItem(RECOVERY_JOURNAL))throw Error('检测到未完成的数据操作，已保留原始记录并暂停写入；请勿清除应用数据');}
