import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const vpcCidrBlock = config.require("vpcCidrBlock");
const subnetBaseCidrBlock = config.require("subnetBaseCidrBlock");

// Get data about the current availability zones
const azsData = aws.getAvailabilityZones();

// Create a VPC
const vpc = new aws.ec2.Vpc("myVpc", { 
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: "My VPC"
    }
});

// Create an Internet Gateway and attach it to the VPC
const ig = new aws.ec2.InternetGateway("myIg", { 
    vpcId: vpc.id,
    tags: {
        "Name": "myIg"
    }
});

// Create a public Route Table
const publicRT = new aws.ec2.RouteTable("publicRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "publicRT"
    }
});

// Create a public Route
new aws.ec2.Route("publicRoute", { 
    routeTableId: publicRT.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: ig.id
});

// Create a private Route Table
const privateRT = new aws.ec2.RouteTable("privateRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "privateRT"
    }
});

let firstPublicSubnetId;
let sFinal;
const publicSubnets: pulumi.Output<string>[] = [];
const privateSubnets: pulumi.Output<string>[] = [];

aws.getAvailabilityZones().then(azs => {
    // Create a public and private subnet in each availability zone
    azs.names.forEach((zone, index) => {
        console.log(index)
        if (index < 3) {
            // Create a public subnet
            const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index}.0/24`,
                mapPublicIpOnLaunch: true,
                availabilityZone: zone,
                tags: {
                    "Name": `publicSubnet-${index}`,
                    "Type": "Public"
                }
            });

            // Store the public subnet ID in the list
            publicSubnets.push(publicSubnet.id);

            // Use the first public subnet for the EC2 instance
            if (index === 2) {
                // Print the first public subnet ID
                pulumi.all(publicSubnets).apply(subnetIds => {
                    console.log("First Public Subnet IDs:");
                    firstPublicSubnetId = subnetIds
                    console.log(subnetIds);
                    sFinal = firstPublicSubnetId[0]
                    console.log(sFinal);
                });
            }

            // Create set route table association for the public subnet
            new aws.ec2.RouteTableAssociation(`publicRTA-${index}`, {
                routeTableId: publicRT.id,
                subnetId: publicSubnet.id,
            })

            // Create a private subnet
            const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index + 100}.0/24`,
                availabilityZone: zone,
                tags: {
                    "Name": `privateSubnet-${index}`,
                    "Type": "Private"
                }
            });

            // Store the private subnet ID in the list
            privateSubnets.push(privateSubnet.id);

            // Create set route table association for the private subnet
            new aws.ec2.RouteTableAssociation(`privateRTA-${index}`, {
                routeTableId: privateRT.id,
                subnetId: privateSubnet.id,
            });
        }
    });

    // Create Security Group
    const applicationSecurityGroup = new aws.ec2.SecurityGroup("application", {
    description: "security group for application servers",
    vpcId: vpc.id,
    ingress: [
        { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 8080, toPort: 8080, cidrBlocks: ["0.0.0.0/0"] },
    ]
    });

    const ami = aws.ec2.getAmi({
    mostRecent: true,
    owners: ["311813075989"],  
    filters: [{
        name: "is-public",      
        values: ["false"]        
    }, {
        name: "state",           
        values: ["available"]    
    },
    ],
    });

    // Access the AMI ID from the result
    console.log(ami)
    const amiId = ami.then(result => result.id);


    // Create EC2 Instance
    /*const appEc2Instance = new aws.ec2.Instance("app-instance", {
    instanceType: "t2.micro",
    keyName: "awsKey",
    ami: amiId,
    vpcSecurityGroupIds: [applicationSecurityGroup.id],
    subnetId: publicSubnets[0],
    ebsBlockDevices: [{
        deviceName: "/dev/xvda",
        volumeSize: 25,
        volumeType: "gp2",
        deleteOnTermination: true,
    }],
    disableApiTermination: false,
    availabilityZone: azsData.then(azs => azs.names[0]),
    });*/

    // RDS Database SecurityGroup creation
    const databaseSecurityGroup = new aws.ec2.SecurityGroup("database", {
        vpcId: vpc.id,
        ingress: [{  
            protocol: "tcp",
            fromPort: 5432, // port for PostgreSQL
            toPort: 5432, // similarly, port for PostgreSQL
            securityGroups: [applicationSecurityGroup.id]  // references the security group of the application
        }]
    });

    // RDS Parameter Group creation
    const rdsParamGroup = new aws.rds.ParameterGroup("rdsparamgroup", {
        family: "postgres13",  // corresponds to PostgreSQL 13.x
        description: "Group for RDS instance",
        //parameters: [
            /*{
                name: "max_connections",
                value: "100"  // Adjust the value based on your specific requirements
            }]*/
        parameters: [{
             name: "timezone",  // example parameter
             value: "UTF8"
         }]
    });

    const dbSubnetGroup = new aws.rds.SubnetGroup("mysubnetgroup", {
        subnetIds: pulumi.all(privateSubnets),
    });

    // RDS Database Instance (PostgreSQL example)
    const dbInstance = new aws.rds.Instance("dbInstance", {
        allocatedStorage: 20,
        engine: "postgres",
        engineVersion: "13",  // replace with your preferred version
        instanceClass: "db.t3.micro",  // PostgreSQL requires a bit more compute, hence t3.micro
        publiclyAccessible: false,
        username: "csye6225",
        password: "Kashish123",
        dbSubnetGroupName: dbSubnetGroup.name,  // assuming it's placed in a private subnet
        vpcSecurityGroupIds: [databaseSecurityGroup.id],  // attach the security group
        storageType: "gp2",
        identifier: "csye6225", 
        skipFinalSnapshot: true,
        parameterGroupName: rdsParamGroup.name,  // reference earlier created parameter group
        name: "csye6225",
        tags: { 
            Environment: "test", Name: "csye6225-rds-instance" 
        } 
    });

    // Create EC2 Instance
    const appEc2InstanceUserData = new aws.ec2.Instance("app-instance", {
        instanceType: "t2.micro",
        keyName: "awsKey",
        ami: amiId,
        vpcSecurityGroupIds: [applicationSecurityGroup.id],
        subnetId: publicSubnets[0],
        userData: pulumi.all([dbInstance.endpoint, dbInstance.username, dbInstance.password]).apply(([host, user, pass]) => {
            return `#!/bin/bash
                echo DIALECT=${config.get("DIALECT")} >> /etc/environment
                echo DBNAME=${config.get("DBNAME")} >> /etc/environment
                echo DBHOST=${host} >> /etc/environment
                echo APPPORT=${config.get("APPPORT")} >> /etc/environment
                echo DBUSER=${user} >> /etc/environment
                echo DBPASSWORD=${pass} >> /etc/environment
                echo DBPORT=${config.get("DBPORT")} >> /etc/environment
                sudo systemctl daemon-reload
            `;
        }),
        ebsBlockDevices: [{
            deviceName: "/dev/xvda",
            volumeSize: 25,
            volumeType: "gp2",
            deleteOnTermination: true,
        }],
        disableApiTermination: false,
        availabilityZone: azsData.then(azs => azs.names[0]),
        });

    // EC2 instance creation with userdata
    /*const appEc2InstanceUserData = new aws.ec2.Instance("app-instance", { 
        // previous EC2 instance details omitted for brevity
        userData: `#!/bin/bash
        echo DATABASE_HOST=${dbInstance.endpoint} >> /etc/environment
        echo DATABASE_USER=${dbInstance.username} >> /etc/environment
        echo DATABASE_PASSWORD=${dbInstance.password} >> /etc/environment
        `,
    });*/
});