declare module 'multer' {
  import { Request } from 'express';
  
  interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
  }

  interface MulterRequest extends Request {
    file?: MulterFile;
    files?: {
      [fieldname: string]: MulterFile[] | MulterFile;
    };
  }

  function multer(options: any): any;
  export = multer;
}
