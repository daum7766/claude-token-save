// 첫 인자(기본 SIGTERM) 신호를 자기에게 보내 죽는다.
process.kill(process.pid, process.argv[2] || 'SIGTERM');
setTimeout(() => {}, 5000);
