const catchError=(err,req,res,next)=>{
    err.statusCode=err.statusCode || 500
    err.status=err.status||'error'  
    res.status(err.statusCode).json({
        status:err.status,
        success:false,
        message:err.message
    })
}
export default catchError