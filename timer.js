let time =0

const timer =  setInterval(()=>{
    if(time===20){
        clearInterval()
    }
    time++;
    console.log(time);
    
},1000)